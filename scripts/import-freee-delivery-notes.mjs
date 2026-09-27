#!/usr/bin/env node
// ============================================================================
// freee販売の「納品」エクスポートCSVから、delivery_notes 投入用の SQL を生成する。
//
//   node scripts/import-freee-delivery-notes.mjs <freee納品CSV> <出力先.sql> [--clients <clients.json>] [--chunk 350]
//
// 列: 納品No. / 納品日 / 顧客名称 / 納品書件名 / 納品金額(合計) / 納品ステータス / 売上ステータス
//
// 変換:
//   * 納品番号は freee のまま（DEL-0000000005）。アプリの新規発行（D-YYMM-連番）と混ざらない
//   * 納品金額(合計) は税込。税額 = 合計 ÷ 11（切り捨て）、税抜 = 合計 − 税額
//   * 明細は「件名 1式 = 税抜金額」の1行
//   * 状態: 売上ステータス 計上済 → 発行済 / 未計上 → 下書き
//   * 案件は「クライアント名 + 件名」、請求書は「クライアント名 + 件名」で一致するものがあれば紐付ける
//   * 冪等: 同じ納品番号は上書き（アプリ側で付けた案件・請求書の紐付けは残す）
//
// CSV・出力SQL・review.json は取引情報を含むためコミットしない（.gitignore）。
// ============================================================================

import fs from 'node:fs';
import { readCsvRecords, json, makeClientResolver, writeSqlChunks } from './lib/freee.mjs';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const clientsArg = args.includes('--clients') ? args[args.indexOf('--clients') + 1] : null;
const chunkArg = args.includes('--chunk') ? Number(args[args.indexOf('--chunk') + 1]) : 350;
const [csvPath, outPath] = positional;
if (!csvPath || !outPath) {
  console.error('使い方: node scripts/import-freee-delivery-notes.mjs <freee納品CSV> <出力先.sql> [--clients <clients.json>] [--chunk 350]');
  process.exit(1);
}

const records = readCsvRecords(csvPath, ['納品No.', '納品日', '顧客名称', '納品書件名', '納品金額(合計)']);
const resolveClient = makeClientResolver(clientsArg);

const review = { rows: records.length, issued: 0, draft: 0, clients: { exact: 0, partial: [], created: [] }, blankClient: [] };
const notes = [];
for (const r of records) {
  const client = resolveClient(r['顧客名称']);
  if (client.how === 'exact') review.clients.exact++;
  else if (client.how === 'partial') { if (!review.clients.partial.some((x) => x.freee === r['顧客名称'])) review.clients.partial.push({ freee: r['顧客名称'], master: client.name }); }
  else if (client.how === 'blank') review.blankClient.push(r['納品No.']);
  else if (!review.clients.created.includes(client.name)) review.clients.created.push(client.name);

  const title = (r['納品書件名'] || '').trim();
  const total = Math.round(Number(String(r['納品金額(合計)']).replace(/,/g, '')) || 0);
  const tax = Math.floor(total / 11);
  const subtotal = total - tax;
  const status = r['売上ステータス'] === '計上済' ? 'issued' : 'draft';
  review[status]++;
  notes.push({
    number: r['納品No.'], clientName: client.name, title, date: r['納品日'], subtotal, tax, total, status,
    lineItems: [{ id: `fd_${r['納品No.']}`, name: title || '（件名なし）', quantity: 1, unit: '式', unit_price: subtotal, amount: subtotal, tax_rate: 10 }],
    memo: `freee販売から取込（納品ステータス: ${r['納品ステータス'] || '—'} / 売上ステータス: ${r['売上ステータス'] || '—'}）`,
  });
}
notes.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));

const importFunction = `
create or replace function pg_temp.import_delivery_note(j jsonb) returns void language plpgsql as $fn$
begin
  insert into public.delivery_notes (delivery_number, project_id, estimate_id, invoice_id, client_id, client_name, title, delivery_date,
    line_items, subtotal, tax, total, tax_breakdown, status, notes, created_at)
  values (
    j->>'number',
    (select p.id from public.projects p
      where p.client_name = j->>'client_name' and (p.name = j->>'title' or p.legacy_data->>'案件名称' = j->>'title')
      order by p.registered_at desc limit 1),
    (select e.id from public.estimates e
      where e.client_name = j->>'client_name' and e.estimate_title = j->>'title' and e.status <> 'rejected'
      order by abs(e.estimate_date - (j->>'date')::date) nulls last limit 1),
    case when j->>'status' = 'issued' then (select i.id from public.invoices i
      where i.client_name = j->>'client_name' and i.title = j->>'title'
      order by abs(i.invoice_date - (j->>'date')::date) limit 1) end,
    (select c.id from public.clients c where c.name = j->>'client_name' order by c.created_at limit 1),
    j->>'client_name', j->>'title', (j->>'date')::date,
    j->'line_items', (j->>'subtotal')::numeric, (j->>'tax')::numeric, (j->>'total')::numeric,
    jsonb_build_array(jsonb_build_object('rate', 10, 'taxable', (j->>'subtotal')::numeric, 'tax', (j->>'tax')::numeric)),
    j->>'status', j->>'memo', (j->>'date')::timestamptz)
  on conflict (delivery_number) do update set
    client_name = excluded.client_name, client_id = excluded.client_id,
    project_id = coalesce(public.delivery_notes.project_id, excluded.project_id),
    estimate_id = coalesce(public.delivery_notes.estimate_id, excluded.estimate_id),
    invoice_id = coalesce(public.delivery_notes.invoice_id, excluded.invoice_id),
    title = excluded.title, delivery_date = excluded.delivery_date, line_items = excluded.line_items,
    subtotal = excluded.subtotal, tax = excluded.tax, total = excluded.total, tax_breakdown = excluded.tax_breakdown,
    status = excluded.status, notes = excluded.notes;
end;
$fn$;
`.trim();

const line = (n) => `select pg_temp.import_delivery_note(${json({
  number: n.number, client_name: n.clientName, title: n.title, date: n.date, line_items: n.lineItems,
  subtotal: n.subtotal, tax: n.tax, total: n.total, status: n.status, memo: n.memo,
})});`;

const written = writeSqlChunks({
  outPath, rows: notes, chunkSize: chunkArg, fn: importFunction, line,
  header: (part, total) => [
    '-- freee販売 納品エクスポートの取込（scripts/import-freee-delivery-notes.mjs が生成）',
    `-- 生成: ${new Date().toISOString()}  行数: ${records.length}` + (total > 1 ? `  分割: ${part}/${total}（番号順に実行する）` : ''),
    '-- 冪等: 同じ納品番号は上書き。アプリ側で付けた案件・見積・請求書の紐付けは残す。',
    `-- ---- 納品書（この部分: ${total > 1 ? '分割 ' + part : notes.length + '件'}） ----`,
  ],
});
const reviewPath = outPath.replace(/\.sql$/, '') + '-review.json';
fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2));
console.log(`納品書: ${notes.length}件 → ${written.join(', ')}`);
console.log(`状態: 発行済 ${review.issued} / 下書き ${review.draft}　クライアント一致 ${review.clients.exact} / 部分一致 ${review.clients.partial.length} / 新規 ${review.clients.created.length}　顧客名なし ${review.blankClient.length}`);
console.log(`レビュー: ${reviewPath}`);
