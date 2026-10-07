// CV メンバーに共有するときの「▼種類_クライアント名_案件名」＋ URL の文面
import { toast } from "sonner";

/** 「▼議事録_株式会社マルト商事_ふくしま県産品再生支援事業関連\nhttps://…」の形にする（空の項目は飛ばす） */
export function shareText(kind, parts, url) {
  const head = [kind, ...parts.map((p) => String(p || "").trim()).filter(Boolean)].join("_");
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
