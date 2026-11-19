import { requireMember, requirePost, adminClient } from './_lib/guard.js';
import { assertPublicUrl, captureUrl } from './_lib/browser.js';

export { captureUrl };

// ============================================================================
// POST /api/capture-url  { url }
//
// ネット印刷の価格ページなどを開いてスクリーンショットを撮り、非公開バケット
// `uploads` に保存して、そのパス（明細の screenshot_path に入れる値）を返す。
// 手でスクショを撮ってシートに貼る代わりに使う。
//
// ブラウザは Vercel 上のヘッドレス Chrome（@sparticuz/chromium + puppeteer-core）。
// 起動に 2〜4 秒、ページの表示待ちに数秒かかるので、1 回 5〜15 秒が目安。
// ローカルで試すときは環境変数 CHROME_PATH に Chrome/Chromium の実行ファイルを指定する。
// ============================================================================

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const user = await requireMember(req, res);
  if (!user) return;
  let url;
  try { url = assertPublicUrl(req.body?.url); } catch (err) { res.status(400).json({ error: err.message }); return; }

  const started = Date.now();
  try {
    const { png, title, height } = await captureUrl(url);
    const admin = adminClient();
    const path = `screenshots/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.png`;
    const { error } = await admin.storage.from('uploads').upload(path, png, { contentType: 'image/png', upsert: false });
    if (error) throw new Error(`保存できませんでした: ${error.message}`);
    res.status(200).json({ path, title, height, ms: Date.now() - started });
  } catch (err) {
    console.error('[api/capture-url]', err);
    const msg = /net::ERR_NAME_NOT_RESOLVED|ENOTFOUND/.test(String(err.message)) ? 'ページが見つかりません（URL を確認してください）'
      : /timeout/i.test(String(err.message)) ? 'ページの読み込みが時間内に終わりませんでした'
      : (err.message || '撮影に失敗しました');
    res.status(500).json({ error: msg });
  }
}
