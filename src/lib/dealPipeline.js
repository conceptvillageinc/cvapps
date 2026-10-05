// ============================================================================
// 案件の積み上げ（確定／見込）: 売上粗利管理表のシミュレーションのパターンごとに持つ、手入力の一覧。
//   行 = { id, section: "confirmed"|"forecast", name, sales, purchase, memo, tag, project_id, sort }
//   金額は税別・円。税込は ×1.1 で見せるだけ。
//   区分（色と意味）と人数・1 人あたりの目標は、期のシミュレーション文書（fiscal_targets.simulation）の
//   トップレベルに持つ（パターンをまたいで共通）。
// ============================================================================

export const TAX_RATE = 0.1;
const n = (v) => Math.round(Number(String(v ?? "").replace(/[,¥￥\s]/g, "")) || 0);

/** 区分に使える色（Tailwind のクラスは静的に並べておく） */
export const DEAL_COLORS = {
  orange: { label: "オレンジ", row: "bg-orange-100", chip: "bg-orange-400", text: "text-orange-900" },
  yellow: { label: "黄", row: "bg-yellow-100", chip: "bg-yellow-400", text: "text-yellow-900" },
  rose: { label: "ピンク", row: "bg-rose-100", chip: "bg-rose-400", text: "text-rose-900" },
  sky: { label: "水色", row: "bg-sky-100", chip: "bg-sky-400", text: "text-sky-900" },
  emerald: { label: "緑", row: "bg-emerald-100", chip: "bg-emerald-500", text: "text-emerald-900" },
  violet: { label: "紫", row: "bg-violet-100", chip: "bg-violet-400", text: "text-violet-900" },
  slate: { label: "グレー", row: "bg-slate-200", chip: "bg-slate-400", text: "text-slate-900" },
};
export const DEAL_COLOR_KEYS = Object.keys(DEAL_COLORS);

/** 区分の初期値（見込の角度）。名前と色は設定で変えられる */
export const DEFAULT_DEAL_TAGS = [
  { id: "high", label: "確度 高", color: "orange" },
  { id: "mid", label: "確度 中", color: "yellow" },
  { id: "low", label: "確度 低", color: "rose" },
  { id: "next", label: "次年度", color: "sky" },
];
export const MAX_DEAL_TAGS = 8;

/** 1 人あたりの目標の初期値（税別・円） */
export const DEFAULT_PER_PERSON = { sales: 25_000_000, gross: 15_000_000 };

export const SECTIONS = [
  ["confirmed", "確定"],
  ["forecast", "見込（未確定）"],
];

/** 保存されている区分をそろえる（無ければ初期値） */
export function normalizeDealTags(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const tags = list
    .filter((t) => t && t.id && String(t.label || "").trim())
    .map((t) => ({ id: String(t.id), label: String(t.label).trim(), color: DEAL_COLORS[t.color] ? t.color : "slate" }))
    .slice(0, MAX_DEAL_TAGS);
  return tags.length > 0 ? tags : DEFAULT_DEAL_TAGS.map((t) => ({ ...t }));
}

/** 保存されている行をそろえる */
export function normalizeDeals(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((d) => d && d.id)
    .map((d, i) => ({
      id: String(d.id),
      section: d.section === "confirmed" ? "confirmed" : "forecast",
      name: String(d.name || ""),
      sales: n(d.sales),
      purchase: n(d.purchase),
      memo: String(d.memo || ""),
      tag: d.tag ? String(d.tag) : "",
      project_id: d.project_id || null,
      sort: Number.isFinite(Number(d.sort)) ? Number(d.sort) : i,
    }))
    .sort((a, b) => a.sort - b.sort);
}

export function newDeal(section, patch = {}) {
  return { id: crypto.randomUUID(), section, name: "", sales: 0, purchase: 0, memo: "", tag: "", project_id: null, sort: 0, ...patch };
}

/** 並び順を 0,1,2… に振り直す（区分ごと） */
export function renumber(deals) {
  const bySection = { confirmed: 0, forecast: 0 };
  return deals.map((d) => ({ ...d, sort: bySection[d.section]++ }));
}

/** 売上・仕入（税別）から、税込・粗利・粗利率を出す */
export function totalsOf(rows) {
  const sales = rows.reduce((s, d) => s + n(d.sales), 0);
  const purchase = rows.reduce((s, d) => s + n(d.purchase), 0);
  const gross = sales - purchase;
  return {
    count: rows.length,
    sales, purchase, gross,
    sales_tax: Math.round(sales * (1 + TAX_RATE)), purchase_tax: Math.round(purchase * (1 + TAX_RATE)), gross_tax: Math.round(gross * (1 + TAX_RATE)),
    margin: sales > 0 ? gross / sales : null,
  };
}

/**
 * 一覧全体のまとめ。
 * @param {object} p
 * @param {object[]} p.deals
 * @param {number} p.grossMust        最低粗利目標（必達粗利の年間合計・税別）
 * @param {number} p.headcount        人数
 * @param {number} p.perPersonSales   売上／人 の目標
 * @param {number} p.perPersonGross   粗利／人 の目標
 */
export function pipelineSummary({ deals, grossMust = 0, headcount = 0, perPersonSales = DEFAULT_PER_PERSON.sales, perPersonGross = DEFAULT_PER_PERSON.gross }) {
  const confirmed = totalsOf(deals.filter((d) => d.section === "confirmed"));
  const forecast = totalsOf(deals.filter((d) => d.section === "forecast"));
  const all = totalsOf(deals);
  const vsTarget = (gross) => ({ diff: gross - n(grossMust), rate: n(grossMust) > 0 ? gross / n(grossMust) : null });
  const perPerson = (t) => (headcount > 0 ? { sales: Math.round(t.sales / headcount), gross: Math.round(t.gross / headcount) } : { sales: null, gross: null });
  return {
    confirmed: { ...confirmed, target: vsTarget(confirmed.gross), per_person: perPerson(confirmed) },
    forecast,
    all: { ...all, target: vsTarget(all.gross), per_person: perPerson(all) },
    grossMust: n(grossMust),
    headcount: n(headcount),
    perPersonSales: n(perPersonSales) || DEFAULT_PER_PERSON.sales,
    perPersonGross: n(perPersonGross) || DEFAULT_PER_PERSON.gross,
  };
}

/** 案件一覧の案件を見込の行にする */
export function dealFromProject(p, tags) {
  const prob = String(p.deal_probability || "");
  const tag = /^A/.test(prob) ? tags[0]?.id : /^B/.test(prob) ? tags[1]?.id : /^C/.test(prob) ? tags[2]?.id : "";
  return newDeal("forecast", {
    name: [p.client_name, p.name].filter(Boolean).join("　"),
    sales: n(p.expected_revenue),
    purchase: n(p.expected_cost) + n(p.other_cost),
    memo: [prob ? `確度 ${prob}` : "", p.project_number || ""].filter(Boolean).join("・"),
    tag: tag || "",
    project_id: p.id,
  });
}

const csvCell = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** CSV（Excel で開ける BOM 付き）。確定・見込の行と、まとめ */
export function pipelineToCsv({ deals, tags, summary, fiscalLabel }) {
  const tagLabel = (id) => tags.find((t) => t.id === id)?.label || "";
  const lines = [["区分", "分類", "クライアント名・件名", "売上（税別）", "仕入（税別）", "粗利（税別）", "備考"]];
  for (const [key, label] of SECTIONS) {
    for (const d of deals.filter((x) => x.section === key)) lines.push([label, tagLabel(d.tag), d.name, d.sales, d.purchase, d.sales - d.purchase, d.memo]);
  }
  lines.push([]);
  const row = (label, t) => lines.push([label, "", "", t.sales, t.purchase, t.gross, t.margin === null ? "" : `粗利率 ${(t.margin * 100).toFixed(2)}%`]);
  row("確定 計（税別）", summary.confirmed);
  row("見込 計（税別）", summary.forecast);
  row("確定＋見込 計（税別）", summary.all);
  lines.push(["確定＋見込 計（税込）", "", "", summary.all.sales_tax, summary.all.purchase_tax, summary.all.gross_tax, ""]);
  lines.push(["最低粗利目標", "", "", "", "", summary.grossMust, summary.all.target.rate === null ? "" : `達成率 ${(summary.all.target.rate * 100).toFixed(2)}%`]);
  if (summary.headcount > 0) {
    lines.push([`売上／人（${summary.headcount} 人）`, "", "", summary.all.per_person.sales, "", "", `目標 ${summary.perPersonSales}`]);
    lines.push([`粗利／人（${summary.headcount} 人）`, "", "", "", "", summary.all.per_person.gross, `目標 ${summary.perPersonGross}`]);
  }
  return "﻿" + [[`案件の積み上げ ${fiscalLabel || ""}`], ...lines].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
