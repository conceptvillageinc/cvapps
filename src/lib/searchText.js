// ============================================================================
// 一覧の検索で、文字の書き方の違いを気にせず見つかるようにする
//   ・半角カナ（ﾏﾙﾄ）と全角カナ（マルト）、全角英数字（ＡＢＣ１）と半角（ABC1）を同じに（NFKC）
//   ・ひらがな（まると）とカタカナ（マルト）を同じに
//   ・濁点が別の文字になっているもの（「ふ」＋「゛」）も「ぶ」に（NFKC に含まれる）
//   ・大文字・小文字、空白（全角・半角）、見えない文字（ゼロ幅スペースなど）は無視
// ============================================================================

export function normalizeForSearch(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)) // ひらがな → カタカナ
    .replace(/[\s​-‍⁠﻿]/g, "")
    .toLowerCase();
}

/** 検索語（query）が、fields のどれかに含まれるか。検索語が空なら true */
export function matchesSearchText(fields, query) {
  const q = normalizeForSearch(query);
  if (!q) return true;
  return fields.some((f) => normalizeForSearch(f).includes(q));
}

// 見積番号の探し方をゆるくする（「Q958」「Q-958」「0958」でも「Q-0000000958」が、「CV2607001」「2607-1」でも「CV-2607-001」が見つかる）
//   ・ハイフンなどの区切りを無視
//   ・数字の頭の 0 を省いて打っても見つかる
const compactNumber = (value) => normalizeForSearch(value).replace(/[^0-9a-z]/g, "");
// 頭の 0 は、区切りで分かれた数字ごとに省く（CV-2607-001 → cv26071）
const looseNumber = (value) => normalizeForSearch(value).replace(/\d+/g, (d) => d.replace(/^0+(?=\d)/, "")).replace(/[^0-9a-z]/g, "");

/** 検索語（query）が見積番号（number）に当たるか。検索語が空なら true */
export function matchesEstimateNumber(number, query) {
  const q = compactNumber(query);
  if (!q) return !normalizeForSearch(query);
  const n = compactNumber(number);
  if (!n) return false;
  return n.includes(q) || looseNumber(number).includes(looseNumber(query));
}
