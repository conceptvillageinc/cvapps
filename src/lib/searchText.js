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
