#!/usr/bin/env node
// ============================================================================
// freee の「請求書一覧」エクスポートCSVから、invoices 投入用の SQL を生成する。
//
//   node scripts/import-freee-invoices.mjs <freee請求書CSV> <出力先.sql> [--chunk 150]
//
// 列: 請求No. / 請求日 / 請求先名称 / 請求書件名 / 請求金額(税抜) / 送付ステータス
//
// 変換:
//   * 番号は freee のまま（INV-0000000655）。新規発行分は I-YYMM-連番 なので混ざらない
//   * 請求先名称の運用タグ（【freee送付】など）を剥がす（案件の取込と同じ規則）
//   * 件名の先頭の【入金済】→ 状態 = 入金済（入金日は不明なので空）。それ以外は
//     送付ステータス true → 送付済 / false → 下書き
//   * 消費税は 10% として計算（freee の CSV に税額が無いため）
//   * 案件は「クライアント名 + 件名」が一致する案件があれば紐付ける
//
// 出力は取引情報を含むためコミットしない（supabase/seed_*.sql は .gitignore 済み）。
// ============================================================================

import fs from 'node:fs';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const chunkArg = args.includes('--chunk') ? Number(args[args.indexOf('--chunk') + 1]) : 0;
const [csvPath, outPath] = positional;
if (!csvPath || !outPath) {
  console.error('使い方: node scripts/import-freee-invoices.mjs <freee請求書CSV> <出力先.sql> [--chunk 150]');
  process.exit(1);
}

function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const raw = fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
const [header, ...lines] = parseCsv(raw);
const records = lines.map((cols) => Object.fromEntries(header.map((h, i) => [h, cols[i] ?? ''])));
for (const col of ['請求No.', '請求日', '請求先名称', '請求書件名', '請求金額(税抜)']) {
  if (!header.includes(col)) { console.error(`CSVに「${col}」列がありません`); process.exit(1); }
}

const q = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const json = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;

const TAG_RE = /【[^】]*】/g;
function splitClient(name) {
  const tags = (name.match(TAG_RE) || []).join('');
  let rest = name.replace(TAG_RE, '').trim();
  const m = rest.match(/^((?:請求[^\s]*?(?:確認中|要確認))|(?:※[^！!]*[！!]+))/);
  if (m) rest = rest.slice(m[1].length).trim();
  return { tags, name: rest };
}

const review = { rows: records.length, paid: 0, sent: 0, draft: 0, blankClient: [], clients: new Set() };
const invoices = [];
for (const r of records) {
  const { name: clientName } = splitClient(r['請求先名称']);
  let title = r['請求書件名'] || '';
  const paid = /【入金済】/.test(title);
  title = title.replace(/【入金済】/g, '').trim();
  const status = paid ? 'paid' : (String(r['送付ステータス']).toLowerCase() === 'true' ? 'sent' : 'draft');
  review[status === 'paid' ? 'paid' : status === 'sent' ? 'sent' : 'draft']++;
  if (!clientName) review.blankClient.push(r['請求No.']);
  else review.clients.add(clientName);

  const subtotal = Math.round(Number(String(r['請求金額(税抜)']).replace(/,/g, '')) || 0);
  const tax = Math.floor(subtotal * 0.1);
  const invoiceDate = r['請求日'];
  const [y, m] = invoiceDate.split('-').map(Number);
  const due = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10); // 翌月末

  invoices.push({
    legacyId: `freee:${r['請求No.']}`,
    number: r['請求No.'],
    clientName: clientName || '（請求先名なし）',
    title, invoiceDate, due, subtotal, tax, total: subtotal + tax, status,
    lineItems: [{ id: `di_${r['請求No.']}`, name: title || '（件名なし）', quantity: 1, unit: '式', unit_price: subtotal, amount: subtotal, tax_rate: 10, transaction_date: invoiceDate }],
    legacy: { '請求先名称': r['請求先名称'], '請求書件名': r['請求書件名'], '送付ステータス': r['送付ステータス'] },
  });
}
invoices.sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.number.localeCompare(b.number));

const importFunction = `
create or replace function pg_temp.import_invoice(j jsonb) returns void language plpgsql as $fn$
begin
  insert into public.invoices (invoice_number, project_id, client_id, client_name, title, invoice_date, due_date,
    line_items, subtotal, tax, total, tax_breakdown, status, sent_at, paid_at, legacy_id, legacy_data)
  values (
    j->>'number',
    (select p.id from public.projects p
      where p.client_name = j->>'client_name' and p.name = j->>'title' order by p.registered_at desc limit 1),
    (select c.id from public.clients c where c.name = j->>'client_name' order by c.created_at limit 1),
    j->>'client_name', j->>'title', (j->>'invoice_date')::date, (j->>'due_date')::date,
    j->'line_items', (j->>'subtotal')::numeric, (j->>'tax')::numeric, (j->>'total')::numeric,
    jsonb_build_array(jsonb_build_object('rate', 10, 'taxable', (j->>'subtotal')::numeric, 'tax', (j->>'tax')::numeric)),
    j->>'status',
    case when j->>'status' in ('sent','paid') then (j->>'invoice_date')::timestamptz end,
    null,
    j->>'legacy_id', j->'legacy_data')
  on conflict (invoice_number) do update set
    client_name = excluded.client_name, client_id = excluded.client_id, project_id = coalesce(public.invoices.project_id, excluded.project_id),
    title = excluded.title, invoice_date = excluded.invoice_date, line_items = excluded.line_items,
    subtotal = excluded.subtotal, tax = excluded.tax, total = excluded.total, tax_breakdown = excluded.tax_breakdown,
    status = case when public.invoices.status = 'paid' then 'paid' else excluded.status end,
    legacy_data = excluded.legacy_data;
end;
$fn$;
`.trim();

const line = (inv) => `select pg_temp.import_invoice(${json({
  number: inv.number, client_name: inv.clientName, title: inv.title, invoice_date: inv.invoiceDate, due_date: inv.due,
  line_items: inv.lineItems, subtotal: inv.subtotal, tax: inv.tax, total: inv.total, status: inv.status,
  legacy_id: inv.legacyId, legacy_data: inv.legacy,
})});`;

const chunks = chunkArg > 0 ? Array.from({ length: Math.ceil(invoices.length / chunkArg) }, (_, i) => invoices.slice(i * chunkArg, (i + 1) * chunkArg)) : [invoices];
const written = [];
chunks.forEach((chunk, idx) => {
  const lines = [
    '-- freee 請求書エクスポートの取込（scripts/import-freee-invoices.mjs が生成）',
    `-- 生成: ${new Date().toISOString()}  行数: ${records.length}` + (chunks.length > 1 ? `  分割: ${idx + 1}/${chunks.length}（番号順に実行する）` : ''),
    '-- 冪等: 同じ請求番号は上書き。すでに入金済にしたものは入金済のまま。',
    'begin;', '',
    `-- ---- 請求書（${chunk.length}件） ----`, importFunction, '',
    ...chunk.map(line),
    '', 'commit;',
  ];
  const file = chunks.length > 1 ? outPath.replace(/\.sql$/, '') + `_${idx + 1}.sql` : outPath;
  fs.writeFileSync(file, lines.join('\n') + '\n');
  written.push(file);
});
const reviewPath = outPath.replace(/\.sql$/, '') + '-review.json';
fs.writeFileSync(reviewPath, JSON.stringify({ ...review, clients: [...review.clients].sort() }, null, 2));
console.log(`請求書: ${invoices.length}件 → ${written.join(', ')}`);
console.log(`状態: 入金済 ${review.paid} / 送付済 ${review.sent} / 下書き ${review.draft}　請求先 ${review.clients.size}社　請求先名なし ${review.blankClient.length}件`);
console.log(`レビュー: ${reviewPath}`);
