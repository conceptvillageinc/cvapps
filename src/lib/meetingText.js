// 議事録の本文（概要・打ち合わせメモ）の改行を整える
//
//   概要          … 「。」ごとに 1 文 1 行にする（括弧の中の「。」では切らない）
//   打ち合わせメモ … 【見出し】を行頭に置き、見出しの前に空行を入れる。本文はそのまま
//                   見出しが 1 つも無いときは、概要と同じく 1 文 1 行にする
//
// 何度かけても結果が変わらない（すでに整っている文章はそのまま）ので、AI が作った
// 直後にも、保存済みの議事録を開いたときにも同じ関数を通している。

const OPEN = "「『（(【［[";
const CLOSE = "」』）)】］]";
const SPACE = /[ 　\t]/;

const tidy = (s) => s.split("\n").map((l) => l.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();

/** 「。」ごとに改行する。括弧の中では切らず、既にある改行はそのまま */
export function breakSentences(text) {
  const s = String(text || "").replace(/\r\n?/g, "\n");
  let out = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (OPEN.includes(ch)) depth++;
    else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
    out += ch;
    if (ch !== "。" || depth > 0) continue;
    let j = i + 1;
    while (j < s.length && SPACE.test(s[j])) j++;
    if (j < s.length && s[j] !== "\n" && !CLOSE.includes(s[j])) {
      out += "\n";
      i = j - 1;
    }
  }
  return tidy(out);
}

const HEADING = /(^|[。\n\s」』）)])[ 　]*(【[^【】\n]{1,40}】)[ 　]*\n*/g;

/** 【見出し】ごとに段落にする。見出しが無ければ 1 文 1 行 */
export function formatSections(text) {
  const s = String(text || "").replace(/\r\n?/g, "\n");
  if (!/【[^【】\n]{1,40}】/.test(s)) return breakSentences(s);
  return tidy(s.replace(HEADING, "$1\n\n$2\n"));
}

export const formatOverview = breakSentences;
export const formatNotes = formatSections;

/** summary の概要・打ち合わせメモを整えたコピーを返す */
export function formatSummaryText(summary) {
  if (!summary || typeof summary !== "object") return summary;
  return { ...summary, overview: formatOverview(summary.overview), notes: formatNotes(summary.notes) };
}
