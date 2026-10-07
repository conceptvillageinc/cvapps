// CV メンバーに共有するときの「▼種類_クライアント名_案件名」＋ URL の文面
import { toast } from "sonner";

// クライアント名から外す法人格（長くなるため）。前に付く場合も後ろに付く場合も外す
const ENTITY_TYPES = ["株式会社", "合同会社", "特定非営利活動法人", "NPO法人", "ＮＰＯ法人", "一般社団法人", "（株）", "(株)", "㈱"];

/** 「株式会社マルト商事」→「マルト商事」 */
export function shortClientName(name) {
  let s = String(name || "").trim();
  for (const t of ENTITY_TYPES) s = s.split(t).join(" ");
  return s.replace(/[\s\u3000]+/g, " ").trim() || String(name || "").trim();
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
