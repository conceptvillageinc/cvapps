// 議事録の「見積条件」（印刷物・制作/開発・予算）と、見積への流し込み
import { newPrintSpec } from "@/lib/printSpecs";
import { designItemsTotal } from "@/lib/designCatalog";

/** 制作・開発の区分。順番は デザイン → システム構築 → web構築 */
export const WORK_KINDS = [
  { key: "design", label: "デザイン", category: "デザイン費" },
  { key: "system", label: "システム構築", category: "システム構築費" },
  { key: "web", label: "web構築", category: "web構築費" },
];
export const WORK_OWNERS = [
  { key: "internal", label: "社内" },
  { key: "external", label: "外注" },
];
export const DEFAULT_DAY_RATE = 60000;

const uid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[,¥￥円\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export const PRINT_FIELDS = [
  ["print_type", "印刷物種別"], ["quantities", "部数"], ["size", "サイズ"], ["paper_type", "用紙"],
  ["color_count", "色数"], ["finishing", "加工"], ["due_date", "納期"], ["budget", "予算（税別）"],
];
export const WORK_FIELDS = [
  ["kind", "区分"], ["description", "内容"], ["days", "工数（人日）"], ["day_rate", "人日単価（税別）"],
  ["owner", "担当"], ["due_date", "納期"], ["other_cost", "その他（外注・実費）"], ["budget", "予算（税別）"],
  ["design_items", "デザイン費マスタの項目"],
];

/** 区分がデザインで、デザイン費マスタの項目で見積るもの（人日ではない） */
export const isDesignByMaster = (w) => w?.kind === "design" && w?.pricing !== "days";

export function newPrintCondition(defaults = {}) {
  return { id: uid("pc"), print_type: "", quantities: "", size: "", paper_type: "", color_count: "", finishing: "", due_date: "", usage: "", budget: "", notes: "", evidence: {}, ...defaults };
}
export function newWorkCondition(defaults = {}) {
  return { id: uid("wc"), kind: "design", description: "", days: "", day_rate: String(DEFAULT_DAY_RATE), owner: "internal", due_date: "", other_cost: "", budget: "", evidence: {}, pricing: "master", design_items: [], design_note: "", ...defaults };
}

/** デザイン費マスタから選んだ 1 項目（見積の明細 1 行になる） */
export function newDesignItem(defaults = {}) {
  return { id: uid("di"), master_id: null, category: "", name: "", selling_price: 0, quantity: 1, ...defaults };
}

const normalizeDesignItems = (raw) => (Array.isArray(raw) ? raw : [])
  .filter((d) => d && d.name)
  .map((d) => newDesignItem({ ...d, id: d.id || uid("di"), selling_price: num(d.selling_price) || 0, quantity: num(d.quantity) || 1 }));

/** DB や AI から来た値を画面で扱える形にそろえる */
export function normalizeConditions(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const prints = (Array.isArray(c.prints) ? c.prints : []).map((p) => newPrintCondition({
    ...p,
    id: p.id || uid("pc"),
    quantities: Array.isArray(p.quantities) ? p.quantities.join(" / ") : (p.quantities ?? ""),
    budget: p.budget ?? "",
    evidence: p.evidence && typeof p.evidence === "object" ? p.evidence : {},
  }));
  const works = (Array.isArray(c.works) ? c.works : []).map((w) => newWorkCondition({
    ...w,
    id: w.id || uid("wc"),
    kind: WORK_KINDS.some((k) => k.key === w.kind) ? w.kind : "design",
    owner: WORK_OWNERS.some((o) => o.key === w.owner) ? w.owner : "internal",
    days: w.days ?? "",
    day_rate: w.day_rate ?? String(DEFAULT_DAY_RATE),
    other_cost: w.other_cost ?? "",
    budget: w.budget ?? "",
    evidence: w.evidence && typeof w.evidence === "object" ? w.evidence : {},
    design_items: normalizeDesignItems(w.design_items),
    design_note: w.design_note || "",
    // デザインは原則マスタの項目で見積る。以前の（人日だけ入った）データは人日のまま扱う
    pricing: w.pricing === "days" || w.pricing === "master" ? w.pricing
      : (w.kind === "design" && num(w.days) && !(Array.isArray(w.design_items) && w.design_items.length)) ? "days" : "master",
  }));
  return { budget: c.budget ?? "", budget_evidence: c.budget_evidence || "", prints, works, generated_at: c.generated_at || null };
}

/** 制作・開発 1 件の費用。デザインはマスタの項目の合計、それ以外は 人日 × 人日単価 */
export const workBuildCost = (w) => (isDesignByMaster(w) ? designItemsTotal(w.design_items) : Math.round((num(w.days) || 0) * (num(w.day_rate) || 0)));

/** 空欄の項目（未確認）を数える。usage・notes・予算は任意なので数えない */
export function missingFields(item, kind) {
  const keys = kind === "print"
    ? ["print_type", "quantities", "size", "paper_type", "color_count", "finishing", "due_date"]
    : isDesignByMaster(item)
      ? ["kind", "description", "design_items", "owner", "due_date"]
      : ["kind", "description", "days", "day_rate", "owner", "due_date"];
  return keys.filter((k) => Array.isArray(item[k]) ? item[k].length === 0 : (item[k] === "" || item[k] === null || item[k] === undefined));
}

/** 「2,000 / 3,000」「500 ×3種」のような部数の文字列から数値の一覧を作る */
export function parseQuantities(text) {
  const s = String(text || "");
  const nums = [];
  const mult = s.match(/(\d[\d,]*)\s*[×x×]\s*(\d+)\s*種?/);
  if (mult) {
    const each = Number(mult[1].replace(/,/g, ""));
    const n = Number(mult[2]);
    if (each > 0 && n > 0) nums.push(each * n);
  }
  if (nums.length === 0) {
    for (const m of s.matchAll(/(\d[\d,]*)/g)) {
      const n = Number(m[1].replace(/,/g, ""));
      if (n > 0 && !nums.includes(n)) nums.push(n);
    }
  }
  return nums;
}

/**
 * 見積条件から、新しい見積に入れる値を作る。
 * 印刷物 → 印刷仕様（印刷所への依頼用。明細は返答を待つ）
 * 制作・開発 → 明細行（人日 × 人日単価。その他実費があればもう 1 行）
 */
export function conditionsToEstimate(raw, meeting) {
  const c = normalizeConditions(raw);
  const print_specs = c.prints.map((p) => newPrintSpec({
    label: [p.print_type, p.size].filter(Boolean).join(" ") || "",
    print_type: p.print_type || "",
    size: p.size || "",
    paper_type: p.paper_type || "",
    color_count: p.color_count || "",
    finishing: p.finishing || "",
    usage: p.usage || "",
    quantities: parseQuantities(p.quantities),
    desired_delivery_date: p.due_date || "",
    notes: [p.notes, /[×x]\s*\d+\s*種/.test(String(p.quantities)) ? `部数の内訳: ${p.quantities}` : "", p.budget ? `予算の目安（税別）: ¥${Number(num(p.budget)).toLocaleString()}` : ""].filter(Boolean).join("\n"),
  }));
  const line_items = [];
  for (const w of c.works) {
    const kind = WORK_KINDS.find((k) => k.key === w.kind) || WORK_KINDS[0];
    const days = num(w.days) || 0;
    const rate = num(w.day_rate) || 0;
    if (isDesignByMaster(w)) {
      // デザイン費マスタの項目 → 見積の「デザイン費」の明細（+明細を追加 → デザイン費 で選んだのと同じ形）
      if (w.design_items.length > 0) {
        for (const d of w.design_items) {
          const qty = num(d.quantity) || 1;
          line_items.push({
            id: uid("li"), row_type: "item", category: "デザイン費",
            name: d.name, quantity: qty, unit: "式", unit_price: num(d.selling_price), amount: Math.round(qty * num(d.selling_price)),
            tax_rate: 10, source_type: "design_master", source_ref: `${d.category}:${d.name}`, notes: w.owner === "external" ? "外注" : "",
          });
        }
      } else if (w.description) {
        // マスタに該当が無かったもの。金額 0 で入れて、見積側で決めてもらう
        line_items.push({
          id: uid("li"), row_type: "item", category: "デザイン費",
          name: w.description, quantity: 1, unit: "式", unit_price: 0, amount: 0,
          tax_rate: 10, source_type: "manual", source_ref: "議事録", notes: `デザイン費マスタに該当なし。金額を入れてください${w.design_note ? `（${w.design_note}）` : ""}`,
        });
      }
    } else if (w.description || days > 0) {
      line_items.push({
        id: uid("li"), row_type: "item", category: kind.category,
        name: w.description || kind.category, quantity: days || 1, unit: "人日", unit_price: rate, amount: Math.round((days || 1) * rate),
        tax_rate: 10, source_type: "manual", source_ref: "議事録", notes: w.owner === "external" ? "外注" : "",
      });
    }
    const other = num(w.other_cost);
    if (other) {
      line_items.push({ id: uid("li"), row_type: "item", category: "自由入力", name: `${w.description || kind.category}（外注・実費）`, quantity: 1, unit: "式", unit_price: other, amount: other, tax_rate: 10, source_type: "manual", source_ref: "議事録" });
    }
  }
  const dues = [...c.prints.map((p) => p.due_date), ...c.works.map((w) => w.due_date)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return {
    print_specs,
    line_items,
    meeting_budget: num(c.budget),
    desired_delivery_date: dues[0] || "",
    estimate_title: meeting?.title || "",
  };
}
