import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// ============================================================================
// サーバーでブラウザ（ヘッドレス Chrome）を動かしてページを開く。
//   ・captureUrl: 見積の「URL から読み取り」で、価格ページのスクリーンショットを撮る（api/capture-url.js）
//   ・browsePage: AI チャットで、Claude の Web ページ読み込みで読めないページを、ブラウザで開いて読む（api/ai-chat.js）
// ============================================================================

// 日本語フォント（PDF と同じ Noto Sans JP）。Vercel のブラウザには日本語フォントが無いので、
// 起動前に読み込ませる（無いと日本語の文字が全部抜けたスクショになる）
// ブラウザは Vercel 上のヘッドレス Chrome（@sparticuz/chromium + puppeteer-core）。
// ローカルで試すときは環境変数 CHROME_PATH に Chrome/Chromium の実行ファイルを指定する。
const FONT_DIR = path.join(process.cwd(), 'api', '_lib', 'fonts');
const FONT_FILES = ['NotoSansJP-400.ttf', 'NotoSansJP-700.ttf'];

const NAV_TIMEOUT_MS = 25_000;   // ページ読み込みの上限
const SETTLE_MS = 2_500;         // 読み込み後、価格の計算表示などを待つ時間
const MAX_HEIGHT = 4_000;        // 縦に長いページはここまで
const VIEWPORT = { width: 1280, height: 900 };

/** 社内のサーバーや Supabase など、外から見せてはいけない先を開かないようにする */
export function assertPublicUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new Error('URL の形式が正しくありません'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('http または https の URL を指定してください');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.supabase.co') || host.endsWith('.vercel.app')) {
    throw new Error('この URL は撮影できません');
  }
  // 数字だけのホスト（IP）は私設アドレスの可能性があるので不可
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) throw new Error('IP アドレス直指定の URL は撮影できません');
  return u.toString();
}

export async function launchBrowser() {
  const puppeteer = (await import('puppeteer-core')).default;
  if (process.env.CHROME_PATH) {
    return puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ['--no-sandbox', '--disable-gpu', '--lang=ja-JP'] });
  }
  const chromium = (await import('@sparticuz/chromium')).default;
  // executablePath() がブラウザ本体とフォント設定を /tmp に展開する。
  // その後、フォント設定が見に行く /tmp/fonts に Noto Sans JP を置いてから起動する
  const executablePath = await chromium.executablePath();
  try {
    const fontsDir = path.join(os.tmpdir(), 'fonts');
    fs.mkdirSync(fontsDir, { recursive: true });
    for (const f of FONT_FILES) {
      const src = path.join(FONT_DIR, f);
      const dst = path.join(fontsDir, f);
      if (!fs.existsSync(src)) { console.warn('[capture-url] フォントが見つかりません', src); continue; }
      if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
    }
  } catch (err) {
    console.warn('[capture-url] フォントを配置できませんでした', err.message);
  }
  return puppeteer.launch({
    args: [...chromium.args, '--lang=ja-JP', '--font-render-hinting=none'],
    defaultViewport: VIEWPORT,
    executablePath,
    headless: chromium.headless,
  });
}

/** URL を開いて PNG を返す（バッファ）。ページの表示が落ち着くまで少し待つ */
export async function captureUrl(url) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
    } catch (err) {
      // 通信が止まらないページ（広告・計測など）は load まで待てていれば続行する
      if (!/timeout/i.test(String(err.message))) throw err;
    }
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const height = Math.min(MAX_HEIGHT, Math.max(VIEWPORT.height, await page.evaluate(() => document.documentElement.scrollHeight)));
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: VIEWPORT.width, height } });
    const title = await page.title().catch(() => '');
    return { png: Buffer.from(png), title, height };
  } finally {
    await browser.close().catch(() => {});
  }
}


const BROWSE_TEXT_MAX = 30_000;   // AI チャットに渡す本文の上限（文字）
const BROWSE_SHOT_MAX = 3_000;    // スクリーンショットの高さの上限（px）

/**
 * URL をブラウザで開き、表示された本文（文字）と、スクリーンショット（JPEG）を返す。
 *   開いたあとに中身を組み立てるページ（フロアガイド・予約ページなど）も、表示された状態で読める。
 */
export async function browsePage(rawUrl) {
  const url = assertPublicUrl(rawUrl);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
    let status = 0;
    try {
      const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
      status = resp?.status() || 0;
    } catch (err) {
      if (!/timeout/i.test(String(err.message))) throw err;
    }
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const title = await page.title().catch(() => '');
    const finalUrl = page.url();
    const text = String(await page.evaluate(() => document.body?.innerText || '').catch(() => '')).replace(/\n{3,}/g, '\n\n').trim();
    const height = Math.min(BROWSE_SHOT_MAX, Math.max(VIEWPORT.height, await page.evaluate(() => document.documentElement.scrollHeight).catch(() => VIEWPORT.height)));
    const jpeg = Buffer.from(await page.screenshot({ type: 'jpeg', quality: 70, clip: { x: 0, y: 0, width: VIEWPORT.width, height } }));
    return { url: finalUrl, status, title, text: text.length > BROWSE_TEXT_MAX ? `${text.slice(0, BROWSE_TEXT_MAX)}\n…（長いため以降は省略）` : text, jpeg };
  } finally {
    await browser.close().catch(() => {});
  }
}
