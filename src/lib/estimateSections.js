// ============================================================================
// 案件の「見積の区分」（▼の見出しで案件の見積を分ける）
//
//   区分は案件ごとに持つ（projects.estimate_sections）。付けていない案件は今までどおり 1 つのリスト。
//   見積は estimates.estimate_section に区分の id を持つ（空なら「未分類」）。
//   区分ごとに 2 つの役割を持つ:
//     forecast … 見込みに入れる（「見積から見込みを入れる」で最初からチェックする）
//     billing  … 納品書・請求書の元（月末チェックの「納品書を作る」はこの区分の見積から作る）
//   ひな形:
//     補助金     … 補助金提出の見積書（納品書・請求書の元）／実作業の見積書（見込みに入れる）
//     採用・参考 … 採用された見積書（見込み・納品書・請求書）／参考情報としての見積書（どちらにも使わない）
//   補助金を使う案件は projects.uses_subsidy（案件一覧に「補助金」の印・絞り込み）
// ============================================================================

const newId = () => `sec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const SECTION_PRESETS = {
  subsidy: {
    label: "補助金",
    hint: "補助金に出す見積と、実際の作業の見積を分ける",
    subsidy: true,
    sections: [
      { name: "補助金提出の見積書", forecast: false, billing: true },
      { name: "実作業の見積書", forecast: true, billing: false },
    ],
  },
  adopted: {
    label: "採用・参考",
    hint: "何通りか出した見積のうち、採用されたものと参考のものを分ける",
    subsidy: false,
    sections: [
      { name: "採用された見積書", forecast: true, billing: true },
      { name: "参考情報としての見積書", forecast: false, billing: false },
    ],
  },
  custom: {
    label: "自由に作る",
    hint: "見出しの名前を自分で入れる",
    subsidy: false,
    sections: [{ name: "見積書", forecast: true, billing: true }],
  },
};

/** ひな形から区分を作る */
export const sectionsFromPreset = (key) => (SECTION_PRESETS[key]?.sections || []).map((s) => ({ id: newId(), ...s }));
export const newSection = (name = "新しい区分") => ({ id: newId(), name, forecast: false, billing: false });

/** 案件の区分（無ければ空） */
export const sectionsOf = (project) => (Array.isArray(project?.estimate_sections) ? project.estimate_sections.filter((s) => s && s.id) : []);
export const hasSections = (project) => sectionsOf(project).length > 0;

/** 見積の区分（未分類・区分のない案件は null） */
export function sectionOf(project, estimate) {
  const id = estimate?.estimate_section;
  if (!id) return null;
  return sectionsOf(project).find((s) => s.id === id) || null;
}

/** 区分の役割の短い説明（見出しの横の印） */
export function sectionRoleLabels(s) {
  const out = [];
  if (s?.forecast) out.push({ key: "forecast", label: "見込みに入れる", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" });
  if (s?.billing) out.push({ key: "billing", label: "納品書・請求書の元", cls: "bg-sky-50 text-sky-700 ring-sky-200" });
  if (!s?.forecast && !s?.billing) out.push({ key: "ref", label: "参考", cls: "bg-slate-100 text-slate-600 ring-slate-200" });
  return out;
}

/** 見込みに入れる見積か（区分のない案件・未分類は入れる） */
export function usedForForecast(project, estimate) {
  const s = sectionOf(project, estimate);
  return s ? !!s.forecast : true;
}

/** 納品書・請求書の元にする見積か（区分のない案件・未分類は元にする） */
export function usedForBilling(project, estimate) {
  const s = sectionOf(project, estimate);
  return s ? !!s.billing : true;
}

/**
 * 見積を区分ごとに分ける。[{ section, estimates }]（区分の順。最後に未分類。未分類が無ければ出さない）
 *   区分のない案件は [{ section: null, estimates }] の 1 つ
 */
export function groupBySection(project, estimates) {
  const secs = sectionsOf(project);
  if (!secs.length) return [{ section: null, estimates: estimates || [] }];
  const groups = secs.map((s) => ({ section: s, estimates: [] }));
  const rest = { section: null, estimates: [] };
  for (const e of estimates || []) {
    const g = groups.find((x) => x.section.id === e.estimate_section);
    (g || rest).estimates.push(e);
  }
  return rest.estimates.length ? [...groups, rest] : groups;
}
