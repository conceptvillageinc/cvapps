import PDFDocument from 'pdfkit';
import {
  PAGE_MARGINS, registerFonts, signedYen, fmtQty, fmtUnitPrice,
  drawHeader, drawTitle, drawSubjectAndMeta, drawSummary,
  drawTable, drawBreakdown, drawNotes, drawPageNumber, tableTop, rowsFor,
} from './docLayout.js';

// ============================================================================
// 御見積書のPDF（A4縦）。レイアウトは api/_lib/docLayout.js（納品書・請求書と共通）。
//   - 見出し行（テキスト行）・小計行はそのまま表に載せる
//   - 明細は固定行数の枠。ページをまたぐときは表の見出しを繰り返す
//   - 印影は「あり／なし」を選べる（郵送・持参のときは押印するので無し）
// ============================================================================

const fmtDate = (d) => (d ? String(d).slice(0, 10) : '');

function addMonths(dateStr, months) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.getDate();
  d.setMonth(d.getMonth() + Number(months || 0));
  if (d.getDate() !== day) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

/**
 * 小計・税率別の消費税・合計。src/lib/estimateTotals.js と同じ計算（直すときは両方直す）。
 *   税別見積: 消費税 = 税率ごとの合計 × 税率（四捨五入）
 *   税込見積: 消費税 = 税率ごとの合計 × 税率 ÷ (100+税率) の切り捨て、税抜 = 税込 − 消費税
 */
export function estimateTotals(lineItems, taxInclusive = false) {
  const rows = (lineItems || []).filter((li) => li.row_type !== 'text' && li.row_type !== 'subtotal');
  const byRate = new Map();
  for (const li of rows) {
    const rate = Number(li.tax_rate) === 8 ? 8 : 10;
    byRate.set(rate, (byRate.get(rate) || 0) + (Number(li.amount) || 0));
  }
  const breakdown = [...byRate.entries()].sort((a, b) => b[0] - a[0]).map(([rate, sum]) => {
    if (taxInclusive) {
      const tax = Math.floor((sum * rate) / (100 + rate));
      return { rate, taxable: sum - tax, tax };
    }
    return { rate, taxable: sum, tax: Math.round((sum * rate) / 100) };
  });
  const subtotal = breakdown.reduce((s, b) => s + b.taxable, 0);
  const tax = breakdown.reduce((s, b) => s + b.tax, 0);
  return { subtotal, tax, total: subtotal + tax, breakdown: breakdown.length ? breakdown : [{ rate: 10, taxable: 0, tax: 0 }] };
}

/** ダウンロード用のファイル名（【クライアント名】見積書_件名.pdf） */
export function estimateFilename(estimate) {
  const clean = (s) => String(s || '').replace(/[\\/:*?"<>|\r\n]/g, '_').trim();
  const title = clean(estimate.estimate_title) || clean(estimate.estimate_number) || '見積書';
  return `【${clean(estimate.client_name) || 'クライアント'}】見積書_${title}.pdf`;
}

/**
 * @param {object} opts
 * @param {object} opts.estimate   estimates の行（schema_version 2）
 * @param {object} opts.client     clients の行（住所用。無くてもよい）
 * @param {object} opts.company    company_info
 * @param {Buffer|null} opts.stamp 印影PNG（null なら押さない）
 * @param {Buffer|null} [opts.logo] ロゴ画像
 * @returns {Promise<Buffer>}
 */
export function renderEstimatePdf({ estimate, client, company, stamp, logo = null }) {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margins: PAGE_MARGINS, info: { Title: `御見積書 ${estimate.estimate_number || ''}` } });
    const chunks = [];
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    registerFonts(pdf);

    try {
      drawEstimate(pdf, { estimate, client: client || {}, company, stamp, logo });
    } catch (err) {
      reject(err);
      return;
    }
    pdf.end();
  });
}

function drawEstimate(pdf, { estimate, client, company, stamp, logo }) {
  const items = Array.isArray(estimate.line_items) ? estimate.line_items : [];
  const taxInclusive = !!estimate.tax_inclusive;
  const totals = estimateTotals(items, taxInclusive);
  const estimateDate = estimate.estimate_date || new Date().toISOString().slice(0, 10);
  const validityMonths = estimate.validity_period_months ?? 6;
  const validUntil = addMonths(estimateDate, validityMonths);

  const rows = items.map((li) => {
    if (li.row_type === 'text') return { kind: 'text', text: String(li.text || '') };
    if (li.row_type === 'subtotal') return { kind: 'subtotal', name: li.name || '小計', amount: li.amount };
    const name = `${li.name || ''}${Number(li.tax_rate) === 8 ? '（軽減8%）' : ''}`;
    const qty = `${fmtQty(li.quantity)} ${li.unit || ''}`.trim();
    return { kind: 'item', cells: [name, qty, fmtUnitPrice(li.unit_price), signedYen(li.amount)] };
  });

  const summaryBottom = 287 + 16 + 26;
  const tableY = tableTop(summaryBottom);
  const rowsPerPage = rowsFor(tableY);
  const pages = Math.max(1, Math.ceil(rows.length / rowsPerPage));

  const columns = [
    ['摘要', 0, 'left'],
    ['数量', 63, 'center'],
    [taxInclusive ? '単価(税込)' : '単価', 63, 'right'],
    [taxInclusive ? '明細金額(税込)' : '明細金額', 88, 'right'],
  ];

  for (let p = 0; p < pages; p++) {
    if (p > 0) pdf.addPage();

    drawHeader(pdf, {
      client: { postal: client.postal_code, address: client.address, name: estimate.client_name, honorific: estimate.client_honorific ?? '御中' },
      company,
      person: estimate.person_in_charge || company.representative || '',
      stamp,
      logo,
    });
    drawTitle(pdf, '御見積書');
    drawSubjectAndMeta(pdf, estimate.estimate_title || estimate.print_type || '', [
      ['見積日', fmtDate(estimateDate)],
      ['見積書番号', estimate.estimate_number || ''],
      ['有効期限', fmtDate(validUntil)],
    ]);
    let y = drawSummary(pdf, { subtotal: totals.subtotal, tax: totals.tax, total: totals.total, totalLabel: '見積金額' });
    y = tableTop(y);
    const tableBottom = drawTable(pdf, y, { columns, rows: rows.slice(p * rowsPerPage, (p + 1) * rowsPerPage), rowsPerPage });

    if (p === pages - 1) {
      const bb = drawBreakdown(pdf, tableBottom, totals.breakdown);
      drawNotes(pdf, bb, estimate.additional_notes);
    }
    drawPageNumber(pdf, p + 1, pages);
  }
}
