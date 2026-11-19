// ============================================================================
// AI チャットの「デザイン作成」
//   Claude が、決まった大きさの「ボード」（例: 楽天の商品画像 1000×1000）を HTML で 1 枚ずつ作り、
//   アプリが右側にキャンバスとして並べて見せる。直しは、ボードごとに書き換える。
//   できたデザインは回答の used_data に { kind: 'design', title, boards, notes, assets } として残す。
//
//   ・写真などの画像: チャットに添付した画像を、HTML の中で src="asset:A1" のように指す。表示・書き出しのときに本物の URL に置き換える
//   ・書き出し: サーバーのブラウザでボードを開いて PNG にする（全部のときは ZIP）
//   ・安全のため: 画面では scripts を動かさない iframe（sandbox）で表示。書き出しでは Google Fonts と画像以外の通信を止める
// ============================================================================

export const BOARD_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const BOARD_HTML_MAX = 60000;
const BOARDS_MAX = 30;
const NOTE_COLORS = ['yellow', 'orange', 'green', 'blue', 'pink', 'gray'];

export const DESIGN_TOOLS = [
  {
    name: 'put_board',
    description: 'デザインのボードを 1 枚作る・書き換える（同じ id なら上書き）。html はボード 1 枚分の HTML（<div> 1 つから始まる断片。<html> や <script> は使わない）。',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        id: { type: 'string', description: '英数字・-・_ の名前（例: thumb1, chef2）。直すときは同じ id' },
        title: { type: 'string', description: 'ボードの名前（例: 01 サムネイル｜1枚用）' },
        width: { type: 'integer', description: '幅（px）' },
        height: { type: 'integer', description: '高さ（px）' },
        html: { type: 'string', description: 'ボードの HTML（インラインの style で作る。幅・高さはボードと同じ固定の大きさ）' },
      },
      required: ['id', 'title', 'width', 'height', 'html'],
    },
  },
  {
    name: 'remove_board',
    description: 'ボードを消す',
    input_schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'set_design_info',
    description: 'デザイン全体の名前と、付せん（注意点・確認事項・掲載順などのメモ）を決める。付せんは全部を渡す（前のものは置き換え）',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'デザインの名前（例: 楽天 冷凍ピッツァ 商品画像ラフ）' },
        notes: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' }, color: { type: 'string', enum: NOTE_COLORS } }, required: ['text', 'color'] },
        },
      },
      required: ['title', 'notes'],
    },
  },
];
export const DESIGN_TOOL_NAMES = new Set(DESIGN_TOOLS.map((t) => t.name));

/** Claude への決まり（今のデザインと、使える画像の一覧も渡す） */
export function designRules(prior, assets) {
  const boards = (prior?.boards || []);
  let budget = 90000;
  const current = boards.map((b) => {
    const html = budget > 0 ? b.html.slice(0, Math.min(b.html.length, budget)) : '（長いため省略。直すときは作り直してください）';
    budget -= html.length;
    return `--- ボード ${b.id}「${b.title}」 ${b.width}×${b.height} ---\n${html}`;
  }).join('\n\n');
  return `
【デザイン作成がオンです】
- 依頼に沿って、デザインの「ボード」を put_board で 1 枚ずつ作ってください（1 回の put_board で 1 枚）。全部作り終えたら set_design_info で名前と付せんを決めてください。
- 大きさは依頼に合わせる（楽天の商品画像なら 1000×1000、Instagram 投稿 1080×1080、A4 チラシ 794×1123 など）。ボードの HTML は、その大きさに固定した <div> 1 つから始め、position・flex・grid とインラインの style で作ってください。
- フォントは Google Fonts の Noto Sans JP・Noto Serif JP などを使えます（HTML の先頭に <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=...&display=swap"> を置く）。<script>、外部の画像の URL、iframe は使えません。
- 写真が無いところは、斜めのしま模様の四角に「写真：〇〇」と書いた仮置きにしてください（あとで差し替える）。チャットに添付された画像は、<img src="asset:ID"> で使えます。
- 価格・数字・受賞歴などの事実は、資料にあるものだけ。分からないものは【要確認】と書くか、付せんに残してください。
- 回答の本文には HTML を書かず、作ったボードの一覧と、デザインの考え方・確認が必要な点だけを短く書いてください。
- 直しを頼まれたときは、直すボードだけを同じ id で put_board し直してください（ほかのボードはそのまま残ります）。
${assets.length ? `\n【使える画像（チャットに添付されたもの）】\n${assets.map((a) => `- asset:${a.id} … ${a.name}`).join('\n')}` : '\n（チャットに添付された画像はありません）'}
${boards.length ? `\n【今のデザイン「${prior.title || ''}」（${boards.length} 枚）】\n${current}${prior.notes?.length ? `\n\n付せん:\n${prior.notes.map((n) => `- (${n.color}) ${n.text}`).join('\n')}` : ''}` : ''}`;
}

/** 前のデザイン（無ければ空）から、この回答で書き換える作業用のデザインを作る */
export function startDesign(prior, assets) {
  return {
    kind: 'design',
    title: prior?.title || 'デザイン',
    boards: (prior?.boards || []).map((b) => ({ ...b })),
    notes: (prior?.notes || []).map((n) => ({ ...n })),
    assets,
    changed: false,
  };
}

/** デザインの道具を実行する（作業用のデザイン state を書き換え、結果の文を返す） */
export function applyDesignTool(state, name, input = {}) {
  if (name === 'put_board') {
    const id = String(input.id || '').trim();
    if (!BOARD_ID_RE.test(id)) return { error: 'id は英数字・-・_ の 40 文字以内にしてください' };
    const width = Math.round(Number(input.width));
    const height = Math.round(Number(input.height));
    if (!(width >= 100 && width <= 4000 && height >= 100 && height <= 4000)) return { error: '幅・高さは 100〜4000 px にしてください' };
    const html = String(input.html || '');
    if (!html.trim()) return { error: 'html が空です' };
    if (html.length > BOARD_HTML_MAX) return { error: `html が長すぎます（${BOARD_HTML_MAX} 文字まで）。仮置きや装飾を減らしてください` };
    if (/<script\b|<iframe\b|<object\b|<embed\b/i.test(html)) return { error: '<script>・<iframe>・<object>・<embed> は使えません' };
    const board = { id, title: String(input.title || id).slice(0, 100), width, height, html };
    const at = state.boards.findIndex((b) => b.id === id);
    if (at >= 0) state.boards[at] = board;
    else if (state.boards.length >= BOARDS_MAX) return { error: `ボードは ${BOARDS_MAX} 枚までです` };
    else state.boards.push(board);
    state.changed = true;
    return { ok: true, message: `ボード ${id} を${at >= 0 ? '書き換え' : '作り'}ました（全 ${state.boards.length} 枚）` };
  }
  if (name === 'remove_board') {
    const before = state.boards.length;
    state.boards = state.boards.filter((b) => b.id !== String(input.id || ''));
    if (state.boards.length === before) return { error: `ボード ${input.id} はありません` };
    state.changed = true;
    return { ok: true, message: `ボード ${input.id} を消しました` };
  }
  if (name === 'set_design_info') {
    state.title = String(input.title || state.title).slice(0, 100);
    state.notes = (Array.isArray(input.notes) ? input.notes : []).slice(0, 20).map((n) => ({ text: String(n.text || '').slice(0, 2000), color: NOTE_COLORS.includes(n.color) ? n.color : 'yellow' })).filter((n) => n.text.trim());
    state.changed = true;
    return { ok: true, message: 'デザインの名前と付せんを保存しました' };
  }
  return { error: `不明な道具です: ${name}` };
}

export function designLabel(name, input = {}) {
  if (name === 'put_board') return `デザインのボードを作成（${input.title || input.id || ''}）`;
  if (name === 'remove_board') return `デザインのボードを削除（${input.id || ''}）`;
  return 'デザインの付せんを保存';
}

/** 保存する形（作業用の印を外す） */
export function finishDesign(state) {
  const { changed, ...rest } = state;
  return rest;
}

/** ボードの HTML を、書き出し・表示用の 1 枚のページにする（asset:ID を本物の URL に） */
export function boardDocument(board, assetUrls = {}, { pdf = false } = {}) {
  const html = String(board.html || '').replace(/asset:([A-Za-z0-9_-]+)/g, (m, id) => assetUrls[id] || m);
  const page = pdf ? `@page{size:${board.width}px ${board.height}px;margin:0}html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}` : '';
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${page}html,body{margin:0;padding:0;background:#fff}body{width:${board.width}px;height:${board.height}px;overflow:hidden;font-family:'Noto Sans JP',sans-serif}</style></head><body>${html}</body></html>`;
}

/**
 * ボードを PNG か PDF（ベクター）にする。boards の全部（ZIP）か 1 枚。
 *   通信は Google Fonts と、画像の URL（Storage の署名付き URL）だけを通す
 * @returns {Promise<{ file: Buffer, ext: 'png'|'pdf'|'zip', name?: string }>}
 */
export async function renderBoards(boards, assetUrls, format = 'png') {
  const pdf = format === 'pdf';
  const svg = format === 'svg';
  const ext = pdf ? 'pdf' : svg ? 'svg' : 'png';
  const { launchBrowser } = await import('./browser.js');
  const allowedHosts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com', ...Object.values(assetUrls).map((u) => { try { return new URL(u).hostname; } catch { return ''; } })]);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('data:') || url === 'about:blank') return req.continue();
      let host = '';
      try { host = new URL(url).hostname; } catch { /* 読めない URL は止める */ }
      return allowedHosts.has(host) ? req.continue() : req.abort();
    });
    const out = [];
    for (const b of boards) {
      await page.setViewport({ width: b.width, height: b.height, deviceScaleFactor: 1 });
      await page.setContent(boardDocument(b, assetUrls, { pdf }), { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      // PDF（ベクター）: 文字・図形はベクターのまま、フォントも埋め込まれる（Illustrator で開いて直せる）
      // SVG: 図形と文字（<text>）の SVG にする（Figma で開いて直せる。フォントは Figma の Google Fonts を使う）
      let data;
      if (pdf) data = Buffer.from(await page.pdf({ width: `${b.width}px`, height: `${b.height}px`, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, pageRanges: '1' }));
      else if (svg) data = Buffer.from(await boardToSvg(page), 'utf8');
      else data = Buffer.from(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: b.width, height: b.height } }));
      out.push({ name: `${String(out.length + 1).padStart(2, '0')}_${b.title.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`, data });
    }
    if (out.length === 1) return { file: out[0].data, name: out[0].name, ext };
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    for (const f of out) zip.file(f.name, f.data);
    return { file: await zip.generateAsync({ type: 'nodebuffer' }), ext: 'zip' };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** 開いているボードを SVG の文字列にする（dom-to-svg。画像は SVG の中に埋め込み、URL の期限切れで消えないようにする） */
async function boardToSvg(page) {
  const path = await import('node:path');
  await page.addScriptTag({ path: path.join(process.cwd(), 'api', '_lib', 'vendor', 'dom-to-svg.iife.js') });
  return page.evaluate(async () => {
    // 斜めのしま模様（写真の仮置き）など、繰り返しのグラデーションは SVG にできないので、最初の色の塗りにする
    for (const el of document.querySelectorAll('*')) {
      const bg = getComputedStyle(el).backgroundImage || '';
      if (!/repeating-(linear|radial)-gradient/.test(bg)) continue;
      const first = bg.match(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}/);
      el.style.backgroundImage = 'none';
      if (first) el.style.backgroundColor = first[0];
    }
    const svgDoc = window.CVDomToSvg.elementToSVG(document.body);
    const root = svgDoc.documentElement;
    root.setAttribute('width', String(document.body.offsetWidth));
    root.setAttribute('height', String(document.body.offsetHeight));
    for (const img of [...root.querySelectorAll('image')]) {
      const href = img.getAttribute('href') || img.getAttribute('xlink:href') || '';
      if (!/^https?:/.test(href)) continue;
      try {
        const blob = await (await fetch(href)).blob();
        const dataUrl = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
        img.setAttribute('href', dataUrl);
        img.removeAttribute('xlink:href');
      } catch { /* 読めない画像はそのまま */ }
    }
    return new XMLSerializer().serializeToString(svgDoc);
  });
}
