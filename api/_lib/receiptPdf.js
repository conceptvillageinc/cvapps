import PDFDocument from 'pdfkit';
import { registerFonts, yen, formatPostal, textV } from './docLayout.js';
import { toHalfWidth } from '../../src/lib/halfWidth.js';
import { stampDuty } from '../../src/lib/stampDuty.js';

// ============================================================================
// 領収書の PDF
//   layout 'a5' … A5 横 1 枚（データで送る用）。印紙は不要なので「電子発行」と書く
//   layout 'a4' … A4 縦に、上半分が領収書・下半分が控え（印刷して押印・持参する用）。
//                 間に切り取り線。印紙を貼る欄と税額を出す
// 宛名・金額・但し書き・内訳（税率ごと）・受領方法・自社情報・登録番号・印影。
// ============================================================================

const A5_LANDSCAPE = [595.28, 419.53];
const A4 = [595.28, 841.89];
const M = 30; // 余白
const LINE = '#777777';
const BLACK = '#000000';

const METHOD = { cash: '現金', transfer: '銀行振込', card: 'クレジットカード' };

function jpDate(d) {
  const s = String(d || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : s;
}

/**
 * @param {object} o
 * @param {object} o.receipt   receipts の行
 * @param {object} o.company   company_info
 * @param {Buffer|null} o.stamp 印影（null なら押さない）
 * @param {Buffer|null} [o.logo]
 * @param {'a5'|'a4'} [o.layout='a5']
 */
export function renderReceiptPdf({ receipt, company, stamp, logo = null, layout = 'a5' }) {
  return new Promise((resolve, reject) => {
    const isA4 = layout === 'a4';
    const pdf = new PDFDocument({ size: isA4 ? A4 : A5_LANDSCAPE, margin: 0, info: { Title: `領収書 ${receipt.receipt_number || ''}` } });
    const chunks = [];
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    registerFonts(pdf);
    try {
      if (isA4) {
        const half = A4[1] / 2;
        drawReceipt(pdf, { receipt, company, stamp, logo, x: 0, y: 0, w: A4[0], h: half, paper: true, copy: false });
        // 切り取り線
        pdf.save().lineWidth(0.6).dash(4, { space: 3 }).moveTo(M, half).lineTo(A4[0] - M, half).stroke(LINE).undash().restore();
        pdf.font('jp').fontSize(7).fillColor('#666').text('— 切り取り線 —', 0, half - 4, { width: A4[0], align: 'center', lineBreak: false });
        pdf.fillColor(BLACK);
        drawReceipt(pdf, { receipt, company, stamp, logo, x: 0, y: half, w: A4[0], h: half, paper: true, copy: true });
      } else {
        drawReceipt(pdf, { receipt, company, stamp, logo, x: 0, y: 0, w: A5_LANDSCAPE[0], h: A5_LANDSCAPE[1], paper: false, copy: false });
      }
    } catch (err) { reject(err); return; }
    pdf.end();
  });
}

/** 1 枚分（幅 w・高さ h の領域に描く） */
function drawReceipt(pdf, { receipt, company, stamp, logo, x, y, w, h, paper, copy }) {
  const left = x + M;
  const right = x + w - M;
  const cw = right - left;
  const top = y + M - 6;

  // 外枠（薄い線）。領収書らしい見た目にし、A4 で 2 枚並ぶときの区切りにもなる
  pdf.lineWidth(0.6).rect(x + M / 2, y + M / 2, w - M, h - M).stroke('#bbbbbb');

  // ---- 表題・番号・日付 ----
  pdf.font('jp').fontSize(18).fillColor(BLACK).text(copy ? '領 収 書（控）' : '領 収 書', left, top, { width: cw, align: 'center', lineBreak: false });
  pdf.font('jp').fontSize(8).text(`No. ${receipt.receipt_number || ''}`, left, top + 2, { width: cw, align: 'right', lineBreak: false });
  pdf.text(jpDate(receipt.issue_date), left, top + 14, { width: cw, align: 'right', lineBreak: false });

  // ---- 宛名 ----
  const nameY = top + 40;
  const honorific = receipt.client_honorific || '御中';
  pdf.font('jp').fontSize(13).text(`${receipt.client_name || ''}　${honorific}`, left, nameY, { width: cw * 0.6, lineBreak: false });
  pdf.lineWidth(0.8).moveTo(left, nameY + 20).lineTo(left + cw * 0.6, nameY + 20).stroke(BLACK);

  // ---- 金額の枠 ----
  const boxY = nameY + 34;
  const boxH = 36;
  const boxW = cw * 0.72;
  const boxX = left + (cw - boxW) / 2;
  pdf.lineWidth(1).rect(boxX, boxY, boxW, boxH).stroke(BLACK);
  pdf.font('jp').fontSize(9.5).text('金額', boxX + 10, boxY + 13, { lineBreak: false });
  pdf.font('jp-bold').fontSize(18).text(`¥${yen(receipt.total)}-`, boxX, boxY + 8, { width: boxW, align: 'center', lineBreak: false });
  pdf.font('jp').fontSize(7.5).text('（税込）', boxX + boxW - 46, boxY + 15, { lineBreak: false });

  // ---- 但し書き・領収の文 ----
  const provisoY = boxY + boxH + 12;
  pdf.font('jp').fontSize(9.5).text(`但し　${receipt.proviso || 'お品代として'}`, left + 10, provisoY, { width: cw - 20, lineBreak: false, ellipsis: true });
  pdf.font('jp').fontSize(9.5).text('上記正に領収いたしました。', left + 10, provisoY + 15, { lineBreak: false });

  // ---- 内訳（左下）----
  const bottomTop = provisoY + 48;
  const breakdown = Array.isArray(receipt.tax_breakdown) && receipt.tax_breakdown.length
    ? receipt.tax_breakdown
    : [{ rate: 10, taxable: receipt.subtotal, tax: receipt.tax }];
  const colW = 150;
  let by = bottomTop;
  const row = (label, value, bold = false) => {
    pdf.font(bold ? 'jp-bold' : 'jp').fontSize(7.5).text(label, left, by, { width: colW - 60, lineBreak: false });
    pdf.text(value, left, by, { width: colW, align: 'right', lineBreak: false });
    by += 11;
  };
  pdf.font('jp').fontSize(7.5).fillColor('#333');
  row('内訳', '');
  for (const b of breakdown) {
    row(`${b.rate}%対象（税抜）`, `${yen(b.taxable)}円`);
    row(`消費税（${b.rate}%）`, `${yen(b.tax)}円`);
  }
  row('受領方法', METHOD[receipt.payment_method] || '');
  pdf.lineWidth(0.5).moveTo(left, bottomTop - 3).lineTo(left + colW, bottomTop - 3).stroke(LINE);
  pdf.moveTo(left, by - 2).lineTo(left + colW, by - 2).stroke(LINE);
  pdf.fillColor(BLACK);

  // ---- 収入印紙の欄（中央下）----
  const duty = stampDuty(receipt.subtotal);
  const stampBoxW = 54;
  const stampBoxX = left + colW + 30;
  const stampBoxY = bottomTop;
  if (paper) {
    pdf.save().lineWidth(0.6).dash(2, { space: 2 }).rect(stampBoxX, stampBoxY, stampBoxW, stampBoxW).stroke(LINE).undash().restore();
    pdf.font('jp').fontSize(6.5).fillColor('#555').text('収入印紙', stampBoxX, stampBoxY + 16, { width: stampBoxW, align: 'center', lineBreak: false });
    pdf.text(duty ? `${duty.toLocaleString('ja-JP')}円` : '不要', stampBoxX, stampBoxY + 28, { width: stampBoxW, align: 'center', lineBreak: false });
    if (copy) pdf.text('（控は不要）', stampBoxX - 10, stampBoxY + stampBoxW + 3, { width: stampBoxW + 20, align: 'center', lineBreak: false });
  } else {
    pdf.font('jp').fontSize(6.5).fillColor('#555').text('電子発行のため\n収入印紙は不要です', stampBoxX - 6, stampBoxY + 14, { width: stampBoxW + 12, align: 'center' });
  }
  pdf.fillColor(BLACK);

  // ---- 自社情報（右下）----
  const rx = left + cw * 0.52;
  const rw = right - rx;
  let ry = bottomTop;
  pdf.font('jp-bold').fontSize(9).text(company.name || '', rx, ry, { width: rw, lineBreak: false });
  ry += 13;
  pdf.font('jp').fontSize(7).fillColor('#222');
  const loc = (company.locations || [])[0];
  if (loc) {
    // 住所は英数字を半角にして 1 行に収める（長いときは文字を小さくする）
    textV(pdf, `〒${formatPostal(loc.postal)}　${toHalfWidth(loc.address || '')}`, rx, ry - 1.5, rw, 10, { size: 7, minSize: 5, color: '#222' });
    pdf.font('jp').fontSize(7).fillColor('#222');
    ry += 10;
  }
  const telFax = [company.tel ? `tel ${company.tel}` : '', company.fax ? `fax ${company.fax}` : ''].filter(Boolean).join('｜');
  if (telFax) { pdf.text(telFax, rx, ry, { lineBreak: false }); ry += 10; }
  if (company.registration_number) { pdf.text(`登録番号 ${company.registration_number}`, rx, ry, { lineBreak: false }); ry += 10; }
  if (receipt.person_in_charge) { pdf.text(`担当 ${receipt.person_in_charge}`, rx, ry, { lineBreak: false }); ry += 10; }
  if (logo) { try { pdf.image(logo, rx, ry + 2, { height: 12 }); } catch { /* 省略 */ } }
  pdf.fillColor(BLACK);
  if (stamp) {
    const sw = Math.max(24, Math.min(70, Number(company.stamp_width) || 44));
    try { pdf.image(stamp, right - sw, bottomTop - 6, { width: sw }); } catch { /* 省略 */ }
  }

  // ---- 備考 ----
  const notes = String(receipt.notes || '').trim();
  if (notes) {
    pdf.font('jp').fontSize(6.5).fillColor('#333').text(notes, left, y + h - M + 4, { width: cw, height: 20, ellipsis: true });
    pdf.fillColor(BLACK);
  }
}
