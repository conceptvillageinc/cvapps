// CV メンバーに共有するときの「▼種類_クライアント名_案件名」＋ URL の文面
import { toast } from "sonner";

// クライアント名から外す法人格（長くなるため）。前に付く場合も後ろに付く場合も外す。
// 「医療法人社団」と「医療法人」のように重なるものがあるので、長いものから外す
const ENTITY_TYPES = [
  // 会社
  "株式会社", "有限会社", "合同会社", "合資会社", "合名会社", "有限責任事業組合",
  // 社団・財団・NPO
  "一般社団法人", "一般財団法人", "公益社団法人", "公益財団法人", "特定非営利活動法人", "NPO法人", "ＮＰＯ法人",
  // 医療・福祉・学校・宗教
  "社会医療法人", "医療法人社団", "医療法人財団", "医療法人", "社会福祉法人", "学校法人", "宗教法人",
  // 公的な法人
  "地方独立行政法人", "独立行政法人", "国立大学法人", "公立大学法人", "国立研究開発法人",
  // 士業
  "税理士法人", "弁護士法人", "司法書士法人", "行政書士法人", "社会保険労務士法人", "監査法人", "特許業務法人",
  // その他
  "農事組合法人",
  // 1 文字にまとめた記号（㈱㈲㈳㈶㈴㈾）
  "㈱", "㈲", "㈳", "㈶", "㈴", "㈾",
].sort((a, b) => b.length - a.length);
// （株）(有) (一社) のような略記（全角・半角のかっこ）
const ABBREV = /[（(](?:株|有|同|資|名|社|財|医|学|福|宗|独|特非|一社|一財|公社|公財|医社|医財|社福|学法|税|弁)[）)]/g;
// 英語の表記（末尾の Co., Ltd. / Inc. / LLC など）
const ENGLISH = /[\s,，]*(?:Co\.?,?\s*Ltd\.?|Company\s+Limited|Inc\.?|Incorporated|Corp\.?|Corporation|LLC|L\.L\.C\.|Ltd\.?|Limited)\s*$/i;

/** 「株式会社マルト商事」→「マルト商事」 */
export function shortClientName(name) {
  let s = String(name || "").trim();
  for (const t of ENTITY_TYPES) s = s.split(t).join(" ");
  s = s.replace(ABBREV, " ").replace(ENGLISH, "");
  return s.replace(/[\s　]+/g, " ").trim() || String(name || "").trim();
}

/** 「▼議事録_マルト商事_ふくしま県産品再生支援事業関連\nhttps://…」の形にする（空の項目は飛ばす） */
export function shareText(kind, clientName, title, url) {
  const head = [kind, shortClientName(clientName), String(title || "").trim()].filter(Boolean).join("_");
  return `▼${head}\n${url}`;
}

/** クリップボードへコピーする（使えないブラウザでは手でコピーする欄を出す） */
export async function copyShareText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("タイトルと URL をコピーしました", { description: text });
  } catch {
    window.prompt("この内容をコピーしてください", text.replace("\n", " "));
  }
}
