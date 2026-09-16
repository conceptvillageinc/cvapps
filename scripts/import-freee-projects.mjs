#!/usr/bin/env node
// ============================================================================
// freee販売の「案件」エクスポートCSVから、projects 投入用の SQL を生成する。
//
//   node scripts/import-freee-projects.mjs <freee案件CSV> <出力先.sql> [--clients <clients.json>]
//
// 入力:
//   freee案件CSV   freee販売 → 案件 → エクスポート（顧客名称を含む形式）
//   clients.json   （任意）クライアントマスタの配列 [{ name, ... }]。
//                  部分一致の突合に使う。無い場合は完全一致のみ（SQL側で解決）。
//
// 出力:
//   <出力先.sql>              冪等なSQL。Supabase の SQL Editor に貼って実行する
//   <出力先>-review.json      突合結果・要確認事項のレポート
//
// 取込時の変換:
//   1. 顧客名の運用タグ（【freee送付】【定期あり／freee送付】など）を剥がし、
//      クライアントの「請求書送付方法」「定期売上あり」へ移す
//   2. 案件名の「顧客名／」接頭辞を取る（顧客は別列で持つため）
//   3. クライアントマスタと突合し、無いものは新規作成する
//   4. 案件番号は SQL 側の next_project_number(登録日) で採番する
//      （既存の案件と重ならないように、投入時点のDBを見て決める）
//
// CSV・出力SQL・review.json は取引情報を含むためコミットしない（.gitignore）。
// ============================================================================

import fs from 'node:fs';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const clientsArg = args.includes('--clients') ? args[args.indexOf('--clients') + 1] : null;
const [csvPath, outPath] = positional;

if (!csvPath || !outPath) {
  console.error('使い方: node scripts/import-freee-projects.mjs <freee案件CSV> <出力先.sql> [--clients <clients.json>]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CSV（RFC4180: 引用符内の改行・カンマ・"" に対応）
// ---------------------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const raw = fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
const [header, ...lines] = parseCsv(raw);
const records = lines.map((cols) => Object.fromEntries(header.map((h, i) => [h, cols[i] ?? ''])));

const REQUIRED = ['案件登録日', '顧客名称', '案件名称', '受注確度名称', 'フェーズ名称', '受注見込', '発注見込'];
for (const col of REQUIRED) {
  if (!header.includes(col)) {
    console.error(`CSVに「${col}」列がありません。freee販売の案件エクスポート（顧客名称を含む形式）を指定してください。`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// SQL リテラル
// ---------------------------------------------------------------------------
const q = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? String(n) : '0';
};
const bool = (v) => (v ? 'true' : 'false');
const json = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
const date = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? `'${v.slice(0, 10)}'::date` : 'null');

// ---------------------------------------------------------------------------
// 顧客名の運用タグ
// ---------------------------------------------------------------------------
const TAG_RE = /【[^】]*】/g;

// 顧客名から【…】タグと、「請求書送付先確認中」のような前置きを分離する。
// タグは先頭に付くのが通常だが、前置きの後ろに付いている行もある。
function splitTags(name) {
  const tags = (name.match(TAG_RE) || []).join('');
  let rest = name.replace(TAG_RE, '').trim();
  const prefixNotes = [];
  // 「請求書送付先確認中」「請求先要確認」「※内税！！」のような前置き
  const m = rest.match(/^((?:請求[^\s]*?(?:確認中|要確認))|(?:※[^！!]*[！!]+))/);
  if (m) {
    prefixNotes.push(m[1].replace(/[！!]+$/, ''));
    rest = rest.slice(m[1].length).trim();
  }
  return { tags, name: rest, prefixNotes };
}

function interpretTags(tags, prefixNotes = []) {
  if (!tags && prefixNotes.length === 0) return { method: null, recurring: false, notes: null };
  const t = tags;
  let method = null;
  if (/郵送/.test(t)) method = 'post';
  else if (/個別メール/.test(t)) method = 'email';
  else if (/持参/.test(t)) method = 'hand';
  else if (/freee/.test(t)) method = 'freee';

  const recurring = /定期/.test(t);

  // 方法そのもの以外の情報（宛先指定・要確認など）は補足として残す
  const notes = [...prefixNotes];
  if (/要確認|確認中|別途確認/.test(t)) notes.push('送付方法要確認');
  const extra = t.match(/※[^】／]*/g) || [];
  for (const e of extra) if (!/^※(定期あり|一時的に郵送)$/.test(e)) notes.push(e);
  if (/一時的に郵送/.test(t)) notes.push('一時的に郵送（本来はfreee送付）');
  if (/cc|㏄/i.test(t)) notes.push('CCあり');
  return { method, recurring, notes: notes.length ? [...new Set(notes)].join(' / ') : null };
}

// ---------------------------------------------------------------------------
// クライアント名の正規化（突合用）
// ---------------------------------------------------------------------------
const CORP = /(株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|社会福祉法人|学校法人|医療法人|特定非営利活動法人|NPO法人|㈱|㈲|\(株\)|\(有\))/g;

function normalizeName(name) {
  return (name || '')
    .normalize('NFKC')
    .replace(CORP, '')
    .replace(/[\s　]+/g, '')
    .replace(/[［\[].*?[］\]]/g, '')
    .toLowerCase();
}

let masterClients = [];
if (clientsArg) {
  const parsed = JSON.parse(fs.readFileSync(clientsArg, 'utf8'));
  const arr = Array.isArray(parsed) ? parsed : parsed.entities;
  // 同名は1件にまとめる
  masterClients = [...new Map(arr.map((c) => [c.name, c])).values()];
}
const masterByNorm = new Map();
for (const c of masterClients) {
  const k = normalizeName(c.name);
  if (k && !masterByNorm.has(k)) masterByNorm.set(k, c.name);
}

// 戻り値: { name: 正式名, how: 'exact'|'partial'|'new'|'blank', candidates? }
function resolveClient(freeeName) {
  if (!freeeName) return { name: '（顧客名なし）', how: 'blank' };
  if (masterClients.length === 0) return { name: freeeName, how: 'exact' };

  const exactByName = masterClients.find((c) => c.name === freeeName);
  if (exactByName) return { name: exactByName.name, how: 'exact' };

  const norm = normalizeName(freeeName);
  if (masterByNorm.has(norm)) return { name: masterByNorm.get(norm), how: 'exact' };

  if (norm.length >= 4) {
    // マスタ側が freee の名前を含む（例: freee「○○委員会」/ マスタ「○○委員会 委員長 △△」）
    // → 同じ相手とみなす
    const wider = [...masterByNorm.entries()].filter(([k]) => k.includes(norm)).map(([, name]) => name);
    if (wider.length === 1) return { name: wider[0], how: 'partial', candidates: wider };
    if (wider.length > 1) return { name: freeeName, how: 'new', candidates: wider };

    // freee 側の方が長い（例: freee「福島県農林水産部農業振興課」/ マスタ「福島県 農林水産部」）
    // → 部署違いの可能性があるので新規作成し、候補をレビューに出す
    const narrower = [...masterByNorm.entries()].filter(([k]) => k.length >= 4 && norm.includes(k)).map(([, name]) => name);
    if (narrower.length > 0) return { name: freeeName, how: 'new', similar: narrower };
  }
  return { name: freeeName, how: 'new' };
}

// ---------------------------------------------------------------------------
// 案件名から「顧客名／」の接頭辞を取る
// ---------------------------------------------------------------------------
function stripProjectName(name, clientName) {
  let n = splitTags(name).name;
  if (clientName) {
    for (const sep of ['／', '/', '　', ' ', '_', '＿']) {
      if (n.startsWith(clientName + sep)) return { name: n.slice(clientName.length + sep.length).trim(), stripped: true };
    }
    const nc = normalizeName(clientName);
    const m = n.match(/^(.+?)[／/]\s*(.+)$/);
    if (m && normalizeName(m[1]) === nc) return { name: m[2].trim(), stripped: true };
  }
  return { name: n, stripped: false };
}

// 完了予定日の翌月末
function nextMonthEnd(d) {
  if (!d) return null;
  const [y, m] = d.slice(0, 10).split('-').map(Number);
  const end = new Date(Date.UTC(y, m + 1, 0)); // 翌月の0日 = 翌月末
  return end.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 変換
// ---------------------------------------------------------------------------
const PROBS = ['A', 'C', 'A（定期売上）', '要注意（A）'];
const PHASES = ['引き合い', '着手中', '未着手', '受注済'];

const review = {
  source: csvPath,
  rows: records.length,
  clients: { exact: 0, partial: [], created: [], blank: 0, ambiguous: [], similar: [] },
  tags: {},
  unknownTags: [],
  projectNameStripped: 0,
  blankProbability: [],
  blankPhase: [],
  grossProfitMismatch: [],
  notes: [],
};

const clientUpdates = new Map(); // 正式名 → { method, recurring, notes, isNew }
const projects = [];

for (const r of records) {
  const { tags, name: freeeClient, prefixNotes } = splitTags(r['顧客名称']);
  if (tags) review.tags[tags] = (review.tags[tags] || 0) + 1;
  const tagInfo = interpretTags(tags, prefixNotes);
  if (tags && !tagInfo.method && !tagInfo.recurring && !tagInfo.notes) review.unknownTags.push(tags);

  // 顧客名が空でも、案件名が「顧客名／件名」の形なら顧客名を取り出す
  let clientSource = freeeClient;
  if (!clientSource) {
    const m = splitTags(r['案件名称']).name.match(/^([^／/]+)[／/]/);
    if (m && m[1].trim()) clientSource = m[1].trim();
  }
  const client = resolveClient(clientSource);
  if (client.how === 'exact') review.clients.exact++;
  else if (client.how === 'partial') {
    if (!review.clients.partial.some((x) => x.freee === freeeClient)) review.clients.partial.push({ freee: freeeClient, master: client.name });
  }
  else if (client.how === 'blank') { review.clients.blank++; review.notes.push(`顧客名なし（社内の経費行の可能性）: ${r['案件名称']}`); }
  else {
    if (client.candidates) review.clients.ambiguous.push({ freee: freeeClient, candidates: client.candidates });
    if (client.similar && !review.clients.similar.some((x) => x.freee === freeeClient)) review.clients.similar.push({ freee: freeeClient, similar: client.similar });
    if (!review.clients.created.includes(client.name)) review.clients.created.push(client.name);
  }

  if (client.how !== 'blank') {
    const cur = clientUpdates.get(client.name) || { method: null, recurring: false, notes: [], isNew: client.how === 'new' };
    cur.method = cur.method || tagInfo.method;
    cur.recurring = cur.recurring || tagInfo.recurring;
    if (tagInfo.notes && !cur.notes.includes(tagInfo.notes)) cur.notes.push(tagInfo.notes);
    clientUpdates.set(client.name, cur);
  }

  const pn = stripProjectName(r['案件名称'], clientSource);
  if (pn.stripped) review.projectNameStripped++;

  let prob = r['受注確度名称'].trim();
  if (!PROBS.includes(prob)) {
    if (prob) review.notes.push(`受注確度「${prob}」は選択肢に無いため A にしました: ${r['案件名称']}`);
    else review.blankProbability.push(r['案件名称']);
    prob = 'A';
  }
  let phase = r['フェーズ名称'].trim();
  if (!PHASES.includes(phase)) {
    if (phase) review.notes.push(`フェーズ「${phase}」は選択肢に無いため 引き合い にしました: ${r['案件名称']}`);
    else review.blankPhase.push(r['案件名称']);
    phase = '引き合い';
  }

  const expectedRevenue = Number(num(r['受注見込']));
  const expectedCost = Number(num(r['発注見込']));
  const otherCost = Number(num(r['その他費用(見込)']));
  const confirmedRevenue = Number(num(r['受注合計金額(税抜)']));
  const confirmedCost = Number(num(r['発注合計金額(税抜)']));
  const freeeActualGp = Number(num(r['粗利(実績)']));
  if (freeeActualGp !== confirmedRevenue - confirmedCost) {
    review.grossProfitMismatch.push({
      project: r['案件名称'], freee: freeeActualGp, computed: confirmedRevenue - confirmedCost,
    });
  }

  const dueDate = r['完了予定日'] || null;
  const legacyId = 'freee:' + crypto.createHash('sha1')
    .update([r['登録日時'], r['顧客名称'], r['案件名称']].join('|')).digest('hex').slice(0, 16);

  projects.push({
    legacyId,
    clientName: client.name,
    clientLinked: client.how !== 'blank',
    name: pn.name || r['案件名称'],
    prob, phase,
    expectedRevenue, expectedCost, otherCost, confirmedRevenue, confirmedCost,
    registeredAt: r['案件登録日'],
    dueDate,
    paymentDueDate: nextMonthEnd(dueDate),
    isRecurring: /定期/.test(prob),
    notes: r['社内メモ'] || null,
    createdAt: r['登録日時'] || null,
    legacyData: r,
  });
}

// 登録日順に採番されるよう並べる
projects.sort((a, b) => (a.registeredAt + (a.createdAt || '')).localeCompare(b.registeredAt + (b.createdAt || '')));

// ---------------------------------------------------------------------------
// SQL 出力
// ---------------------------------------------------------------------------
const out = [];
out.push('-- freee販売 案件エクスポートの取込（scripts/import-freee-projects.mjs が生成）');
out.push(`-- 生成: ${new Date().toISOString()}  元: ${csvPath}  行数: ${records.length}`);
out.push('-- 冪等: 同じ案件（legacy_id）は上書き、案件番号は最初に付いたものを維持する。');
out.push('begin;');
out.push('');
out.push('-- ---- クライアント（無ければ作成し、送付方法・定期の有無を反映） ----');

for (const [name, u] of clientUpdates) {
  out.push(
    `insert into public.clients (name, invoice_delivery_method, invoice_delivery_notes, has_recurring_billing, quote_count) ` +
    `select ${q(name)}, ${q(u.method)}, ${q(u.notes.join(' / ') || null)}, ${bool(u.recurring)}, 0 ` +
    `where not exists (select 1 from public.clients where name = ${q(name)});`
  );
  out.push(
    `update public.clients set ` +
    `invoice_delivery_method = coalesce(invoice_delivery_method, ${q(u.method)}), ` +
    `invoice_delivery_notes = coalesce(invoice_delivery_notes, ${q(u.notes.join(' / ') || null)}), ` +
    `has_recurring_billing = has_recurring_billing or ${bool(u.recurring)} ` +
    `where name = ${q(name)};`
  );
}

out.push('');
out.push('-- ---- 案件 ----');
for (const p of projects) {
  const clientId = p.clientLinked
    ? `(select id from public.clients where name = ${q(p.clientName)} order by created_at limit 1)`
    : 'null';
  out.push(
    `insert into public.projects (project_number, client_id, client_name, name, deal_probability, phase, status, ` +
    `expected_revenue, expected_cost, other_cost, confirmed_revenue, confirmed_cost, ` +
    `registered_at, due_date, payment_due_date, is_recurring, notes, legacy_id, legacy_data, created_at) values (` +
    `public.next_project_number(${date(p.registeredAt)}), ${clientId}, ${q(p.clientName)}, ${q(p.name)}, ${q(p.prob)}, ${q(p.phase)}, 'open', ` +
    `${num(p.expectedRevenue)}, ${num(p.expectedCost)}, ${num(p.otherCost)}, ${num(p.confirmedRevenue)}, ${num(p.confirmedCost)}, ` +
    `${date(p.registeredAt)}, ${date(p.dueDate)}, ${date(p.paymentDueDate)}, ${bool(p.isRecurring)}, ${q(p.notes)}, ${q(p.legacyId)}, ${json(p.legacyData)}, ` +
    `${p.createdAt ? `'${p.createdAt}'::timestamptz` : 'now()'}) ` +
    `on conflict (legacy_id) do update set client_id = excluded.client_id, client_name = excluded.client_name, name = excluded.name, ` +
    `deal_probability = excluded.deal_probability, phase = excluded.phase, ` +
    `expected_revenue = excluded.expected_revenue, expected_cost = excluded.expected_cost, other_cost = excluded.other_cost, ` +
    `confirmed_revenue = excluded.confirmed_revenue, confirmed_cost = excluded.confirmed_cost, ` +
    `registered_at = excluded.registered_at, due_date = excluded.due_date, is_recurring = excluded.is_recurring, ` +
    `notes = excluded.notes, legacy_data = excluded.legacy_data;`
  );
}
out.push('');
out.push('commit;');

fs.writeFileSync(outPath, out.join('\n') + '\n');
const reviewPath = outPath.replace(/\.sql$/, '') + '-review.json';
review.clients.createdCount = review.clients.created.length;
review.grossProfitMismatchCount = review.grossProfitMismatch.length;
fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2));

console.log(`案件: ${projects.length}件 → ${outPath}`);
console.log(`クライアント: 完全一致 ${review.clients.exact}行 / 部分一致 ${review.clients.partial.length}社 / 新規作成 ${review.clients.created.length}社（うち似た既存名あり ${review.clients.similar.length}）/ 顧客名なし ${review.clients.blank}行`);
console.log(`案件名の接頭辞を除去: ${review.projectNameStripped}件`);
console.log(`受注確度が空: ${review.blankProbability.length} / フェーズが空: ${review.blankPhase.length}`);
console.log(`粗利(実績)が freee の値と一致しない: ${review.grossProfitMismatch.length}件（元の値は legacy_data に保持）`);
if (review.unknownTags.length) console.log('解釈できなかったタグ:', [...new Set(review.unknownTags)].join(' '));
console.log(`レビュー: ${reviewPath}`);
