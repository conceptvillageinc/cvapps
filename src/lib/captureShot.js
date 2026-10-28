import { db } from "@/api/db";

/**
 * 入稿先・価格ページの URL をサーバーで開いてスクショを撮り、保存したパス（明細の screenshot_path に入れる値）を返す。
 * 1 回 5〜15 秒ほど。撮れなかったときは例外を投げる。
 */
export async function captureUrlShot(url) {
  const { data } = await db.functions.invoke("captureUrl", { url: String(url || "").trim() });
  if (!data?.path) throw new Error(data?.error || "スクショを撮れませんでした");
  return data.path;
}
