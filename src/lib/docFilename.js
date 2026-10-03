// 帳票 PDF のファイル名（画面のダウンロードとサーバーのメール添付で同じ名前にする）
//   【クライアント名御中】見積書_件名.pdf
//   【クライアント名御中】納品書_番号.pdf
//   【クライアント名御中】請求書_番号.pdf
// 敬称は帳票に入れたもの（御中／様）。無ければ 御中

const clean = (s) => String(s || "").replace(/[\\/:*?"<>|\r\n]/g, "_").trim();

export function clientLabel(doc) {
  const name = clean(doc?.client_name) || "クライアント";
  const honorific = clean(doc?.client_honorific) || "御中";
  return `【${name}${honorific}】`;
}

export function estimateFilename(estimate) {
  const title = clean(estimate?.estimate_title) || clean(estimate?.estimate_number) || "見積書";
  return `${clientLabel(estimate)}見積書_${title}.pdf`;
}

export function deliveryNoteFilename(doc) {
  return `${clientLabel(doc)}納品書_${clean(doc?.delivery_number) || "番号未定"}.pdf`;
}

export function invoiceFilename(doc) {
  return `${clientLabel(doc)}請求書_${clean(doc?.invoice_number) || "番号未定"}.pdf`;
}

export function receiptFilename(doc) {
  return `${clientLabel(doc)}領収書_${clean(doc?.receipt_number) || "番号未定"}.pdf`;
}

export function partnerOrderFilename(doc) {
  const name = clean(doc?.partner_name) || "連携先";
  return `【${name}${clean(doc?.partner_honorific) || "御中"}】発注書_${clean(doc?.po_number) || "番号未定"}.pdf`;
}

export function documentFilename(type, doc) {
  if (type === "partner_order") return partnerOrderFilename(doc);
  if (type === "invoice") return invoiceFilename(doc);
  if (type === "delivery") return deliveryNoteFilename(doc);
  if (type === "receipt") return receiptFilename(doc);
  return estimateFilename(doc);
}
