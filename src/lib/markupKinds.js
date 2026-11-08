// ============================================================================
// 印刷費の掛け率の区分（名前に入っている言葉で決める）
//   ラベル・シール : 名前に label_words（ラベル・シール）が入っている → markup.label（既定 1.3）
//   パッケージ     : 名前に package_words（パッケージ）が入っている  → markup.package
//   それ以外       : markup.other
// 「パッケージラベル印刷」のように両方入っているときはラベルを先に見る。
// ただし other_words（既定「箱ラベル」）が入っていれば、ラベルでもパッケージ以外の掛け率にする（いちばん先に見る）。
//   例: 商品のパッケージラベル → 1.3 ／ 箱ラベル → 1.35
// サーバー（スプレッドシート書き出し）でも使うので、ここでは何も読み込まない。
// ============================================================================

export const DEFAULT_MARKUP = { package: 1.3, label: 1.3, other: 1.35 };
export const DEFAULT_LABEL_WORDS = ["ラベル", "シール"];
export const DEFAULT_PACKAGE_WORDS = ["パッケージ"];
export const DEFAULT_OTHER_WORDS = ["箱ラベル"];
export const MARKUP_KIND_LABELS = { label: "ラベル・シール", package: "パッケージ", other: "パッケージ以外" };

const wordsOf = (list, fallback) => (Array.isArray(list) && list.some(Boolean) ? list.filter(Boolean) : fallback);

/**
 * 名前（いくつ渡してもよい。前から順に見る）から掛け率の区分を決める。
 * @returns {{ kind: "label" | "package" | "other", rate: number, word: string }}
 */
export function markupKindOf(rules, ...texts) {
  const m = { ...DEFAULT_MARKUP, ...(rules?.markup || {}) };
  const label = wordsOf(rules?.label_words, DEFAULT_LABEL_WORDS);
  const pkg = wordsOf(rules?.package_words, DEFAULT_PACKAGE_WORDS);
  // パッケージ以外にする言葉は、どの名前に入っていても先に決める（空にしたら使わない）
  const other = Array.isArray(rules?.other_words) ? rules.other_words.filter(Boolean) : DEFAULT_OTHER_WORDS;
  for (const raw of texts) {
    const t = String(raw || "");
    const ow = t && other.find((w) => t.includes(w));
    if (ow) return { kind: "other", rate: Number(m.other) || DEFAULT_MARKUP.other, word: ow };
  }
  for (const raw of texts) {
    const t = String(raw || "");
    if (!t) continue;
    const lw = label.find((w) => t.includes(w));
    if (lw) return { kind: "label", rate: Number(m.label) || DEFAULT_MARKUP.label, word: lw };
    const pw = pkg.find((w) => t.includes(w));
    if (pw) return { kind: "package", rate: Number(m.package) || DEFAULT_MARKUP.package, word: pw };
  }
  return { kind: "other", rate: Number(m.other) || DEFAULT_MARKUP.other, word: "" };
}
