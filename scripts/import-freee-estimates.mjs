#!/usr/bin/env node
// ============================================================================
// freee販売の「見積」エクスポートCSVから、estimates 投入用の SQL を生成する。
//
//   node scripts/import-freee-estimates.mjs <freee見積CSV> <出力先.sql> [--clients <clients.json>] [--chunk 350]
//
// 列: 見積No. / 見積日 / 顧客名称 / 見積書件名 / 見積金額(税抜) / 見積ステータス / 送付ステータス
//
// 変換:
//   * 見積番号は freee のまま（Q-0000000005）。アプリの新規発行は別形式なので混ざらない
//   * 顧客名称の運用タグ（【freee送付】など）を外し、クライアントマスタと突合する
//   * 明細は「件名 1式 = 見積金額(税抜)」の1行。合計は税込（アプリの total_amount と同じ）
//   * 状態: 受注済 → 確定（最終提出版）/ 未回答 → 確定 / 失注 → 確定 + 失注理由
//   * 案件は「クライアント名 + 件名」が一致する案件があれば紐付ける
//   * 冪等: 同じ見積番号は上書き（アプリ側で付けた案件の紐付け・担当者は残す）
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
  console.error('使い方: node scripts/import-freee-estimates.mjs <freee見積CSV> <出力先.sql> [--clients <clients.json>] [--chunk 350]');
  process.exit(1);
}

const records = readCsvRecords(csvPath, ['見積No.', '見積日', '顧客名称', '見積書件名', '見積金額(税抜)', '見積ステータス']);
const resolveClient = makeClientResolver(clientsArg);

const STATUS = {
  '受注済': { status: 'finalized', final: true, prob: 'A', phase: '受注済', lost: null },
  '未回答': { status: 'finalized', final: false, prob: 'A', phase: '引き合い', lost: null },
  '失注': { status: 'finalized', final: false, prob: 'C', phase: '引き合い', lost: 'freee販売で失注' },
};

const review = { rows: records.length, byStatus: {}, clients: { exact: 0, partial: [], created: [] }, unknownStatus: [], blankClient: [] };
const estimates = [];
for (const r of records) {
  const st = STATUS[r['見積ステータス']] || STATUS['未回答'];
  if (!STATUS[r['見積ステータス']]) review.unknownStatus.push(`${r['見積No.']}: ${r['見積ステータス']}`);
  review.byStatus[r['見積ステータス']] = (review.byStatus[r['見積ステータス']] || 0) + 1;

  const client = resolveClient(r['顧客名称']);
  if (client.how === 'exact') review.clients.exact++;
  else if (client.how === 'partial') { if (!review.clients.partial.some((x) => x.freee === r['顧客名称'])) review.clients.partial.push({ freee: r['顧客名称'], master: client.name }); }
  else if (client.how === 'blank') review.blankClient.push(r['見積No.']);
  else if (!review.clients.created.includes(client.name)) review.clients.created.push(client.name);

  const title = (r['見積書件名'] || '').trim();
  const amount = Math.round(Number(String(r['見積金額(税抜)']).replace(/,/g, '')) || 0);
  const tax = Math.round(amount * 0.1);
  const date = r['見積日'];
  estimates.push({
    number: r['見積No.'],
    legacyId: `freee:${r['見積No.']}`,
    clientName: client.name,
    clientLinked: client.how !== 'blank',
    title, date, amount, total: amount + tax,
    status: st.status, final: st.final, prob: st.prob, phase: st.phase, lost: st.lost,
    sent: String(r['送付ステータス']).toLowerCase() === 'true',
    lineItems: [{ id: `fi_${r['見積No.']}`, row_type: 'item', category: 'その他', name: title || '（件名なし）', quantity: 1, unit: '式', unit_price: amount, amount, tax_rate: 10, source_type: 'manual', source_ref: 'freee販売' }],
  });
}
estimates.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));

const importFunction = `
create or replace function pg_temp.import_estimate(j jsonb) returns void language plpgsql as $fn$
begin
  insert into public.estimates (estimate_number, project_id, client_name, client_honorific, estimate_title, estimate_date,
    schema_version, line_items, total_amount, tax_inclusive, status, is_final_submitted, finalized_at,
    deal_probability, phase, lost_reason, legacy_id, created_at)
  values (
    j->>'number',
    (select p.id from public.projects p
      where p.client_name = j->>'client_name' and (p.name = j->>'title' or p.legacy_data->>'案件名称' = j->>'title')
      order by p.registered_at desc limit 1),
    j->>'client_name', '御中', j->>'title', (j->>'date')::date,
    2, j->'line_items', (j->>'total')::numeric, false, j->>'status', (j->>'final')::boolean, (j->>'date')::timestamptz,
    j->>'prob', j->>'phase', j->>'lost', j->>'legacy_id', (j->>'date')::timestamptz)
  on conflict (estimate_number) do update set
    client_name = excluded.client_name,
    project_id = coalesce(public.estimates.project_id, excluded.project_id),
    estimate_title = excluded.estimate_title, estimate_date = excluded.estimate_date,
    line_items = excluded.line_items, total_amount = excluded.total_amount,
    status = excluded.status, is_final_submitted = excluded.is_final_submitted,
    deal_probability = excluded.deal_probability, phase = excluded.phase, lost_reason = excluded.lost_reason;
end;
$fn$;
`.trim();

const line = (e) => `select pg_temp.import_estimate(${json({
  number: e.number, legacy_id: e.legacyId, client_name: e.clientName, title: e.title, date: e.date,
  line_items: e.lineItems, total: e.total, status: e.status, final: e.final, prob: e.prob, phase: e.phase, lost: e.lost,
})});`;

const written = writeSqlChunks({
  outPath, rows: estimates, chunkSize: chunkArg, fn: importFunction, line,
  header: (part, total) => [
    '-- freee販売 見積エクスポートの取込（scripts/import-freee-estimates.mjs が生成）',
    `-- 生成: ${new Date().toISOString()}  行数: ${records.length}` + (total > 1 ? `  分割: ${part}/${total}（番号順に実行する）` : ''),
    '-- 冪等: 同じ見積番号は上書き。アプリ側で付けた案件の紐付けは残す。',
    `-- ---- 見積（この部分: ${total > 1 ? '分割 ' + part : estimates.length + '件'}） ----`,
  ],
});
const reviewPath = outPath.replace(/\.sql$/, '') + '-review.json';
fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2));
console.log(`見積: ${estimates.length}件 → ${written.join(', ')}`);
console.log(`状態: ${JSON.stringify(review.byStatus)}　クライアント一致 ${review.clients.exact} / 部分一致 ${review.clients.partial.length} / 新規 ${review.clients.created.length}　顧客名なし ${review.blankClient.length}`);
console.log(`レビュー: ${reviewPath}`);
