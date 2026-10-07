// ============================================================================
// 議事録の「AI に依頼」の共通部分（画面とサーバーの両方で使う）
//   - よく使う依頼のボタン
//   - 見積のたたき台（draft）の型・合計・新しい見積の明細への変換・スプレッドシートの行
// ============================================================================

export const QUICK_PROMPTS = [
  { label: "見積のベースを作る", text: "議事録の内容と添付資料をもとに、見積のベースを作ってください。" },
  { label: "提案書の骨子", text: "議事録の内容をもとに、次回の打ち合わせで出す提案書の骨子（構成と各ページの要点）を作ってください。" },
  { label: "お礼メールの文面", text: "先方へのお礼と、決定事項・次回までの確認事項を伝えるメールの文面を作ってください。" },
  { label: "ToDo を整理", text: "ToDo を自社・先方に分けて、期限の近い順に整理してください。担当や期限が決まっていないものは分けて挙げてください。" },
];

/** たたき台の各行の根拠の種類 */
export const BASIS_KIND = {
  cost_sheet: { label: "社内見積", cls: "bg-teal-50 text-teal-800 border-teal-200" },
  past_estimate: { label: "過去の見積", cls: "bg-teal-50 text-teal-800 border-teal-200" },
  price_master: { label: "価格マスタ", cls: "bg-teal-50 text-teal-800 border-teal-200" },
  design_master: { label: "デザイン費マスタ", cls: "bg-teal-50 text-teal-800 border-teal-200" },
  material: { label: "添付資料", cls: "bg-teal-50 text-teal-800 border-teal-200" },
  guess: { label: "推測", cls: "bg-red-50 text-red-700 border-red-200" },
};

/** AI に返してもらう形（構造化出力）。見積以外の依頼では draft.items を空にする */
export const CHAT_REPLY_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "依頼への回答（日本語）。見出しは「## 」、箇条書きは「- 」、強調は **…**。表は使わない（見積の明細は draft に入れる）" },
    draft: {
      type: "object",
      description: "見積のたたき台。見積・金額の依頼のときだけ items を入れる。それ以外は title を空、items を空の配列にする",
      properties: {
        title: { type: "string", description: "見積の件名の案" },
        notes: { type: "string", description: "前提条件・含まれないもの・確認が必要な点（1 行 1 項目）" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              group: { type: "string", description: "区分（デザイン費・印刷費・制作費・ディレクション費 など）" },
              name: { type: "string", description: "品名" },
              spec: { type: "string", description: "仕様（サイズ・用紙・色数・ページ数など）。無ければ空" },
              quantity: { type: "number" },
              unit: { type: "string", description: "単位（部・式・枚・点・人日 など）" },
              unit_price: { type: "number", description: "売価の単価（税別・円）" },
              cost_price: { type: "number", description: "原価の単価（税別・円）。分からなければ 0" },
              basis_kind: { type: "string", enum: ["cost_sheet", "past_estimate", "price_master", "design_master", "material", "guess"] },
              basis: { type: "string", description: "単価の根拠（どの社内見積・見積・マスタのどの行か、または推測の理由）" },
              needs_check: { type: "boolean", description: "根拠が弱く、人が確かめるべき行なら true" },
            },
            required: ["group", "name", "quantity", "unit", "unit_price"],
          },
        },
      },
      required: ["title", "items"],
    },
  },
  required: ["reply", "draft"],
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** たたき台の行を整える（数値化・空行の除去） */
export function normalizeDraft(draft) {
  if (!draft || !Array.isArray(draft.items) || draft.items.length === 0) return null;
  const items = draft.items
    .filter((it) => it && String(it.name || "").trim())
    .map((it, i) => ({
      key: `d${i}`,
      group: String(it.group || "").trim(),
      name: String(it.name || "").trim(),
      spec: String(it.spec || "").trim(),
      quantity: num(it.quantity) || 1,
      unit: String(it.unit || "式").trim() || "式",
      unit_price: Math.round(num(it.unit_price) * 100) / 100, // 印刷の単価は小数のことがある（6.2 円など）
      cost_price: num(it.cost_price) || 0,
      basis_kind: BASIS_KIND[it.basis_kind] ? it.basis_kind : "guess",
      basis: String(it.basis || "").trim(),
      needs_check: !!it.needs_check || it.basis_kind === "guess",
    }));
  if (items.length === 0) return null;
  return { title: String(draft.title || "").trim(), notes: String(draft.notes || "").trim(), items };
}

export function draftAmount(it) { return Math.round(num(it.quantity) * num(it.unit_price)); }
export function draftCost(it) { return Math.round(num(it.quantity) * num(it.cost_price)); }

export function draftTotals(items) {
  const subtotal = (items || []).reduce((s, it) => s + draftAmount(it), 0);
  const cost = (items || []).reduce((s, it) => s + draftCost(it), 0);
  const tax = Math.floor(subtotal * 0.1);
  return { subtotal, tax, total: subtotal + tax, cost, gross: subtotal - cost, margin: subtotal > 0 ? (subtotal - cost) / subtotal : null, checks: (items || []).filter((it) => it.needs_check).length };
}

/** 区分ごとにまとめる（並び順は AI が出した順） */
export function draftGroups(items) {
  const out = [];
  for (const it of items || []) {
    let g = out.find((x) => x.group === it.group);
    if (!g) { g = { group: it.group, items: [] }; out.push(g); }
    g.items.push(it);
  }
  return out;
}

/**
 * たたき台の行を、新しい見積の明細にする。
 * @param {object} draft  normalizeDraft 済み
 * @param {string[]} [keys] 使う行（無ければ全部）
 * @param {string} [from]  「議事録『…』の AI 依頼」など、複製元の表示
 */
export function draftToLineItems(draft, keys, from = "") {
  const uid = () => `li_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const wanted = keys ? new Set(keys) : null;
  return (draft?.items || []).filter((it) => !wanted || wanted.has(it.key)).map((it) => ({
    id: uid(),
    row_type: "item",
    category: it.group || "その他",
    name: it.spec ? `${it.name}（${it.spec}）` : it.name,
    quantity: it.quantity,
    unit: it.unit,
    unit_price: it.unit_price,
    amount: draftAmount(it),
    tax_rate: 10,
    cost_price: it.cost_price || null,
    source_type: "manual",
    notes: [it.needs_check ? "【要確認】" : "", it.basis ? `根拠: ${it.basis}` : ""].filter(Boolean).join(" "),
    copied_from: from || "議事録の AI 依頼",
  }));
}

/** スプレッドシートに書く行（見出し 3 行 + 表 + 合計 + 備考） */
export function draftSheetRows(draft, { meetingTitle = "", clientName = "", author = "", date = "" } = {}) {
  const t = draftTotals(draft.items);
  const rows = [
    [`見積のたたき台　${draft.title || meetingTitle}`],
    [`${clientName ? `${clientName}　` : ""}議事録「${meetingTitle}」より　作成 ${date}${author ? `（${author} の依頼）` : ""}`],
    [],
    ["区分", "品名", "仕様", "数量", "単位", "単価（税別）", "金額（税別）", "原価単価", "原価計", "粗利", "根拠の種類", "根拠", "要確認"],
  ];
  for (const it of draft.items) {
    rows.push([it.group, it.name, it.spec, it.quantity, it.unit, it.unit_price, draftAmount(it), it.cost_price || "", draftCost(it) || "", draftAmount(it) - draftCost(it), BASIS_KIND[it.basis_kind]?.label || "", it.basis, it.needs_check ? "要確認" : ""]);
  }
  rows.push([]);
  rows.push(["", "小計（税別）", "", "", "", "", t.subtotal, "", t.cost, t.gross]);
  rows.push(["", "消費税（10%）", "", "", "", "", t.tax]);
  rows.push(["", "合計（税込）", "", "", "", "", t.total]);
  if (draft.notes) {
    rows.push([]);
    rows.push(["前提・確認事項"]);
    for (const line of draft.notes.split(/\r?\n/).filter(Boolean)) rows.push(["", line.replace(/^[-・]\s*/, "")]);
  }
  return rows;
}

/** 添付できるファイルの種類（AI が読めるもの） */
export const CHAT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.csv,.docx,.xlsx,.pptx";
export const CHAT_MAX_FILES = 5;
export const CHAT_MAX_BYTES = 20 * 1024 * 1024;
