#!/usr/bin/env node
// ============================================================================
// Base44 のエクスポートJSONから、Supabase投入用の SQL を生成する。
//
//   node scripts/generate-seed.mjs <エクスポートJSONのディレクトリ> <出力先.sql>
//
// 入力（<dir> に置く）:
//   clients_all.json    Client 全件の配列
//   price_masters.json  { entities: [...] } または配列
//   estimates.json      Estimate（サンプルを除く）の配列
//   small_entities.json { print_vendors, faq_items, system_settings, email_logs }
//
// 出力: 1本の冪等なSQLファイル。Supabase の SQL Editor に貼って実行する。
//
// 移行中に行うクリーンアップ:
//   1. クライアントの重複統合（freeeインポートが複数回走ったため、ほぼ全件が2重）
//   2. 郵便番号の表記ゆれを7桁数字へ正規化（〒付き・ハイフン付きが混在している）
//   3. 見積明細の source_ref を、新しい価格マスタのUUIDへ張り替え
//
// users は seed しない。auth.users への外部キーがあるため、
// 各自がGoogleでログインした時点でトリガーが作成する。
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [, , dirArg, outArg] = process.argv;
if (!dirArg || !outArg) {
  console.error('使い方: node scripts/generate-seed.mjs <エクスポートJSONのdir> <出力先.sql>');
  process.exit(1);
}

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(dirArg, name), 'utf8'));
const asArray = (v) => (Array.isArray(v) ? v : v.entities);

// ---------------------------------------------------------------------------
// SQL リテラル
// ---------------------------------------------------------------------------
const q = (v) => {
  if (v === null || v === undefined || v === '') return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
};
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? 'null' : String(Number(v)));
const bool = (v) => (v ? 'true' : 'false');
const json = (v) => `'${JSON.stringify(v ?? null).replace(/'/g, "''")}'::jsonb`;
const ts = (v) => (v ? `'${v}'::timestamptz` : 'now()');

// 郵便番号: 〒・ハイフン・全角を落として7桁数字にする。
// 7桁にならないものは元の値のまま残し、レビュー対象として報告する。
function normalizePostal(raw) {
  if (!raw) return { value: null, ok: true };
  const digits = String(raw)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[^0-9]/g, '');
  if (digits.length === 7) return { value: digits, ok: true, changed: digits !== String(raw) };
  return { value: String(raw), ok: false };
}

const CLIENT_FIELDS = [
  'name_kana', 'contact_person', 'contact_person_kana',
  'email', 'phone', 'postal_code', 'address', 'notes',
];
const isEmpty = (v) => v === null || v === undefined || v === '';

// ---------------------------------------------------------------------------
// 1. クライアント: 同名レコードを1件に統合する
// ---------------------------------------------------------------------------
function mergeClients(rows) {
  // ページング境界で同じ行を2回拾うことがあるので、まずid重複を除く
  const byId = new Map();
  for (const c of rows) byId.set(c.id, c);
  const unique = [...byId.values()];

  const groups = new Map();
  for (const c of unique) {
    if (!groups.has(c.name)) groups.set(c.name, []);
    groups.get(c.name).push(c);
  }

  const merged = [];
  const review = [];

  for (const [name, group] of groups) {
    group.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));

    // 項目ごとに「最初に見つかった非空の値」を採用する（情報量を最大化）
    const out = { name, legacy_ids: group.map((c) => c.id) };
    for (const f of CLIENT_FIELDS) {
      out[f] = group.map((c) => c[f]).find((v) => !isEmpty(v)) ?? null;
    }
    out.quote_count = Math.max(0, ...group.map((c) => Number(c.quote_count) || 0));
    out.created_date = group[0].created_date;
    out.updated_date = group[group.length - 1].updated_date;

    // 同名なのに中身が食い違うグループは、目視確認できるよう書き出す
    if (group.length > 1) {
      const differing = CLIENT_FIELDS.filter((f) => {
        const vals = new Set(group.map((c) => (isEmpty(c[f]) ? '' : String(c[f]))));
        return vals.size > 1;
      });
      if (differing.length > 0) {
        review.push({ name, differing, rows: group.map((c) => Object.fromEntries([['id', c.id], ...differing.map((f) => [f, c[f]])])) });
      }
    }

    merged.push(out);
  }

  return { merged, review, uniqueInputCount: unique.length };
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------
const clientsRaw = asArray(readJson('clients_all.json'));
const priceMastersRaw = asArray(readJson('price_masters.json'));
const estimatesRaw = asArray(readJson('estimates.json'));
const small = readJson('small_entities.json');

const { merged: clients, review: clientReview, uniqueInputCount } = mergeClients(clientsRaw);

// 郵便番号の正規化
let postalFixed = 0;
const postalReview = [];
for (const c of clients) {
  const r = normalizePostal(c.postal_code);
  if (r.changed) postalFixed++;
  if (!r.ok) postalReview.push({ name: c.name, postal_code: c.postal_code });
  c.postal_code = r.value;
}

// 価格マスタ: legacy_id -> 新UUID
const priceMasterIdMap = new Map();
for (const pm of priceMastersRaw) priceMasterIdMap.set(pm.id, crypto.randomUUID());

// 見積の明細に埋まっている価格マスタ参照を新IDへ張り替える
let remappedRefs = 0;
let danglingRefs = 0;
for (const e of estimatesRaw) {
  for (const item of e.line_items || []) {
    if (item.source_type === 'price_master' && item.source_ref) {
      const next = priceMasterIdMap.get(item.source_ref);
      if (next) {
        item.source_ref = next;
        remappedRefs++;
      } else {
        danglingRefs++;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// SQL 生成
// ---------------------------------------------------------------------------
const L = [];
L.push('-- Base44 からの移行データ');
L.push(`-- scripts/generate-seed.mjs が自動生成（${new Date().toISOString()}）`);
L.push('-- 0001_initial_schema.sql を先に実行しておくこと。');
L.push('-- 同じ legacy_id の行は上書きされるので、再実行しても安全。');
L.push('');
L.push('begin;');
L.push('');

// --- print_vendors ---
L.push('-- 印刷所情報');
for (const v of small.print_vendors) {
  L.push(
    `insert into public.print_vendors (id, name, vendor_type, print_types, email, phone, website_url, contact_person, notes, legacy_id) values (` +
    `${q(crypto.randomUUID())}, ${q(v.name)}, ${q(v.vendor_type)}, ${json(v.print_types || [])}, ` +
    `${q(v.email)}, ${q(v.phone)}, ${q(v.website_url)}, ${q(v.contact_person)}, ${q(v.notes)}, ${q(v.id)})` +
    ` on conflict (legacy_id) do nothing;`
  );
}
L.push('');

// --- price_masters ---
L.push('-- 価格マスタ');
for (const pm of priceMastersRaw) {
  L.push(
    `insert into public.price_masters (id, category, paper_type_group, vendor_name, spec_summary, price_grid, last_updated, screenshot_url, source_url, notes, legacy_id) values (` +
    `${q(priceMasterIdMap.get(pm.id))}, ${q(pm.category)}, ${q(pm.paper_type_group || '紙')}, ${q(pm.vendor_name)}, ` +
    `${q(pm.spec_summary)}, ${json(pm.price_grid || [])}, ${pm.last_updated ? q(pm.last_updated) + '::date' : 'null'}, ` +
    `${q(pm.screenshot_url)}, ${q(pm.source_url)}, ${q(pm.notes)}, ${q(pm.id)})` +
    ` on conflict (legacy_id) do nothing;`
  );
}
L.push('');

// --- clients ---
L.push(`-- クライアント（${uniqueInputCount}件 → 重複統合後 ${clients.length}件）`);
for (const c of clients) {
  L.push(
    `insert into public.clients (id, name, name_kana, contact_person, contact_person_kana, email, phone, postal_code, address, notes, quote_count, legacy_id, created_at, updated_at) values (` +
    `${q(crypto.randomUUID())}, ${q(c.name)}, ${q(c.name_kana)}, ${q(c.contact_person)}, ${q(c.contact_person_kana)}, ` +
    `${q(c.email)}, ${q(c.phone)}, ${q(c.postal_code)}, ${q(c.address)}, ${q(c.notes)}, ${num(c.quote_count)}, ` +
    `${q(c.legacy_ids[0])}, ${ts(c.created_date)}, ${ts(c.updated_date)})` +
    ` on conflict (legacy_id) do nothing;`
  );
}
L.push('');

// --- system_settings ---
L.push('-- システム設定');
for (const s of small.system_settings) {
  L.push(
    `insert into public.system_settings (id, setting_key, setting_value, description, legacy_id) values (` +
    `${q(crypto.randomUUID())}, ${q(s.setting_key)}, ${q(s.setting_value)}, ${q(s.description)}, ${q(s.id)})` +
    ` on conflict (setting_key) do update set setting_value = excluded.setting_value, description = excluded.description;`
  );
}
L.push('');

// --- faq_items ---
L.push('-- Q&A');
for (const f of small.faq_items) {
  L.push(
    `insert into public.faq_items (id, question, answer, sort_order, legacy_id) values (` +
    `${q(crypto.randomUUID())}, ${q(f.question)}, ${q(f.answer)}, ${num(f.sort_order)}, ${q(f.id)})` +
    ` on conflict (legacy_id) do nothing;`
  );
}
L.push('');

// --- estimates ---
L.push(`-- 見積（${estimatesRaw.length}件。サンプル3件は移行対象外）`);
L.push('-- created_by は NULL。auth.users への外部キーがあり、各自の初回ログイン前は解決できないため。');
for (const e of estimatesRaw) {
  L.push(
    `insert into public.estimates (` +
    `id, estimate_number, client_name, client_honorific, person_in_charge, estimate_title, estimate_date, ` +
    `validity_period_months, schema_version, line_items, print_type, size, usage, paper_type, quantities, ` +
    `color_count, desired_delivery_date, additional_notes, status, deal_probability, phase, lost_reason, ` +
    `is_final_submitted, project_group_id, revision_label, total_amount, review_comments, approval_checklist, ` +
    `vendor_prices, selected_vendor, cost_price, selling_price, gross_profit, markup_rate, proofreading_fee, ` +
    `other_fees, design_fees, design_fee_total, legacy_id, legacy_parent_id, created_at, updated_at` +
    `) values (` +
    `${q(crypto.randomUUID())}, ${q(e.estimate_number)}, ${q(e.client_name)}, ${q(e.client_honorific || '御中')}, ` +
    `${q(e.person_in_charge)}, ${q(e.estimate_title)}, ${e.estimate_date ? q(e.estimate_date) + '::date' : 'null'}, ` +
    `${num(e.validity_period_months ?? 6)}, ${num(e.schema_version ?? 1)}, ${json(e.line_items || [])}, ` +
    `${q(e.print_type)}, ${q(e.size)}, ${q(e.usage)}, ${q(e.paper_type)}, ${json(e.quantities || [])}, ` +
    `${q(e.color_count)}, ${e.desired_delivery_date ? q(e.desired_delivery_date) + '::date' : 'null'}, ` +
    `${q(e.additional_notes)}, ${q(e.status || 'draft')}, ${q(e.deal_probability || 'B')}, ${q(e.phase || '未着手')}, ` +
    `${q(e.lost_reason)}, ${bool(e.is_final_submitted)}, ${q(e.project_group_id)}, ${q(e.revision_label)}, ` +
    `${num(e.total_amount)}, ${json(e.review_comments || [])}, ${json(e.approval_checklist || {})}, ` +
    `${json(e.vendor_prices || [])}, ${q(e.selected_vendor)}, ${num(e.cost_price)}, ${num(e.selling_price)}, ` +
    `${num(e.gross_profit)}, ${num(e.markup_rate)}, ${num(e.proofreading_fee ?? 0)}, ${num(e.other_fees ?? 0)}, ` +
    `${json(e.design_fees || [])}, ${num(e.design_fee_total ?? 0)}, ${q(e.id)}, ${q(e.parent_estimate_id)}, ` +
    `${ts(e.created_date)}, ${ts(e.updated_date)})` +
    ` on conflict (legacy_id) do nothing;`
  );
}
L.push('');

// 改訂元の参照を解決（今回のデータには親を持つ見積は無いが、再実行時のために入れておく）
L.push('-- 改訂元（親見積）の参照を legacy_parent_id から解決する');
L.push('update public.estimates child');
L.push('   set parent_estimate_id = parent.id');
L.push('  from public.estimates parent');
L.push(' where child.legacy_parent_id is not null');
L.push('   and parent.legacy_id = child.legacy_parent_id');
L.push('   and child.parent_estimate_id is distinct from parent.id;');
L.push('');

L.push('commit;');
L.push('');

fs.writeFileSync(outArg, L.join('\n'), 'utf8');

// ---------------------------------------------------------------------------
// レポート
// ---------------------------------------------------------------------------
const reviewPath = outArg.replace(/\.sql$/, '') + '-review.json';
fs.writeFileSync(reviewPath, JSON.stringify({ clientReview, postalReview }, null, 2), 'utf8');

console.log('生成しました:', outArg);
console.log('');
console.log('【クライアント】');
console.log(`  入力 ${uniqueInputCount}件（id重複を除いた実数）`);
console.log(`  → 重複統合後 ${clients.length}件（${uniqueInputCount - clients.length}件を統合）`);
console.log(`  同名だが中身が食い違い、目視確認が必要なグループ: ${clientReview.length}件`);
console.log(`  郵便番号を7桁数字へ正規化: ${postalFixed}件 / 7桁にならず要確認: ${postalReview.length}件`);
console.log('');
console.log('【その他】');
console.log(`  印刷所情報: ${small.print_vendors.length}件`);
console.log(`  価格マスタ: ${priceMastersRaw.length}件`);
console.log(`  システム設定: ${small.system_settings.length}件`);
console.log(`  Q&A: ${small.faq_items.length}件`);
console.log(`  見積: ${estimatesRaw.length}件（明細の価格マスタ参照 ${remappedRefs}件を新IDへ張り替え / 解決できず ${danglingRefs}件）`);
console.log('');
console.log('要確認リスト:', reviewPath);
