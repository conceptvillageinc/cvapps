import JSZip from 'jszip';
import { readXlsx } from './xlsx.js';

// ============================================================================
// 添付ファイルから AI に渡す本文を取り出す（PDF・画像は Claude がそのまま読めるので対象外）
//   Word（.docx）・PowerPoint（.pptx）・Excel（.xlsx）・テキスト（.txt .md .csv）
// ライブラリを増やさないため、ZIP の中の XML を正規表現で読む。
// ============================================================================

const MAX_CHARS = 60000; // 1 ファイルあたり（長すぎる資料は先頭から）

const decodeXml = (s) => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

/** 段落（<w:p> / <a:p>）ごとに <w:t> / <a:t> をつなぐ */
function paragraphs(xml, ns) {
  const out = [];
  const pRe = new RegExp(`<${ns}:p\\b[\\s\\S]*?<\\/${ns}:p>`, 'g');
  const tRe = new RegExp(`<${ns}:t(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${ns}:t>`, 'g');
  let pm;
  while ((pm = pRe.exec(xml))) {
    const parts = [];
    let tm;
    while ((tm = tRe.exec(pm[0]))) parts.push(decodeXml(tm[1]));
    tRe.lastIndex = 0;
    const line = parts.join('').trim();
    if (line) out.push(line);
  }
  return out;
}

async function docxText(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('Word の本文が見つかりません');
  return paragraphs(xml, 'w').join('\n');
}

async function pptxText(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const slides = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
  const out = [];
  for (const [i, p] of slides.entries()) {
    const lines = paragraphs(await zip.file(p).async('string'), 'a');
    // ノート（発表者メモ）があれば添える
    const note = zip.file(p.replace('slides/slide', 'notesSlides/notesSlide'));
    const notes = note ? paragraphs(await note.async('string'), 'a').filter((l) => !/^\d+$/.test(l)) : [];
    out.push(`--- スライド ${i + 1} ---\n${lines.join('\n')}${notes.length ? `\n（メモ）${notes.join(' ')}` : ''}`);
  }
  return out.join('\n\n');
}

async function xlsxText(bytes) {
  const { sheets } = await readXlsx(bytes, { withImages: false });
  const out = [];
  for (const s of sheets) {
    const rows = new Map();
    for (const [ref, v] of s.cells) {
      const m = /^([A-Z]+)(\d+)$/.exec(ref);
      if (!m) continue;
      const r = Number(m[2]);
      if (!rows.has(r)) rows.set(r, []);
      rows.get(r).push([m[1], v]);
    }
    const lines = [...rows.keys()].sort((a, b) => a - b).map((r) => {
      const cells = rows.get(r).sort((a, b) => (a[0].length - b[0].length) || a[0].localeCompare(b[0]));
      return `${r}: ${cells.map(([c, v]) => `${c}=${String(v).replace(/\s+/g, ' ')}`).join(' | ')}`;
    });
    out.push(`--- シート「${s.name}」 ---\n${lines.join('\n')}`);
  }
  return out.join('\n\n');
}

const EXT = (name) => String(name || '').split('.').pop().toLowerCase();

/** AI が直接読める形式か（PDF・画像） */
export function isNativeFile(type, name) {
  const ext = EXT(name);
  return type === 'application/pdf' || ext === 'pdf' || /^image\//.test(type || '') || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
}

/**
 * ファイルの本文をテキストで返す。読めない形式は Error。
 * @returns {Promise<string>}
 */
export async function extractText(bytes, { type = '', name = '' } = {}) {
  const ext = EXT(name);
  let text;
  if (ext === 'docx') text = await docxText(bytes);
  else if (ext === 'pptx') text = await pptxText(bytes);
  else if (ext === 'xlsx') text = await xlsxText(bytes);
  else if (['txt', 'md', 'csv', 'tsv'].includes(ext) || /^text\//.test(type)) {
    text = new TextDecoder('utf-8').decode(bytes);
    // Shift_JIS の CSV（Excel で保存したもの）は文字化けするので読み直す
    if (/�/.test(text.slice(0, 2000))) {
      try { text = new TextDecoder('shift_jis').decode(bytes); } catch { /* そのまま */ }
    }
  } else {
    throw new Error(`この形式は読めません（${ext || type || '不明'}）。PDF・画像・Word・Excel・PowerPoint・テキストを添付してください`);
  }
  text = String(text || '').trim();
  if (!text) throw new Error('本文が空でした');
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…（長いため以降は省略）` : text;
}


// ---------------------------------------------------------------------------
// PDF: ページ数が少なければ Claude にそのまま渡し（図・表も読める）、多ければ文字だけを取り出して渡す。
//   長い PDF をそのまま渡すと、1 ページで数千トークンになり、AI チャットの上限（100 万トークン）を超えることがあるため
// ---------------------------------------------------------------------------
export const PDF_DIRECT_MAX_PAGES = 20;          // これ以下のページ数なら、そのまま渡す
export const PDF_DIRECT_MAX_BYTES = 8 * 1024 * 1024;
const PDF_TEXT_MAX = 40000;                      // 文字だけにするときの上限（文字）

/** PDF のページ数と、文字（maxChars まで）を返す。読めない PDF は Error */
export async function pdfText(bytes, { maxChars = PDF_TEXT_MAX } = {}) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const base = new URL('../../node_modules/pdfjs-dist/', import.meta.url);
  const doc = await pdfjs.getDocument({
    // pdf.js は渡したデータを持っていってしまう（元の ArrayBuffer が空になる）ので、写しを渡す
    data: new Uint8Array(bytes).slice(),
    cMapUrl: new URL('cmaps/', base).pathname, cMapPacked: true, // 日本語の PDF（標準の CMap を使うもの）を読むため
    standardFontDataUrl: new URL('standard_fonts/', base).pathname,
    disableFontFace: true, isEvalSupported: false, useSystemFonts: false,
  }).promise;
  const out = [];
  let total = 0;
  let readPages = 0;
  for (let i = 1; i <= doc.numPages && total < maxChars; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const line = tc.items.map((it) => `${it.str || ''}${it.hasEOL ? '\n' : ''}`).join('').replace(/[ \t]+\n/g, '\n').trim();
    const block = `--- ${i} ページ ---\n${line}`;
    out.push(block);
    total += block.length;
    readPages = i;
  }
  await doc.destroy().catch(() => {});
  const text = out.join('\n\n');
  return { pages: doc.numPages, readPages, text: text.length > maxChars ? `${text.slice(0, maxChars)}\n…（長いため以降は省略）` : text };
}

/**
 * PDF を Claude に渡す形にする。ページ数が少なければ document ブロック、多ければ文字だけ。
 * @returns {Promise<Array>} content ブロックの配列
 */
export async function pdfBlocks(bytes, label) {
  let info = null;
  try { info = await pdfText(bytes, { maxChars: PDF_TEXT_MAX }); } catch { /* ページ数が分からないときは大きさだけで決める */ }
  const small = bytes.byteLength <= PDF_DIRECT_MAX_BYTES && (!info || info.pages <= PDF_DIRECT_MAX_PAGES);
  if (small) {
    return [
      { type: 'text', text: label },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(bytes).toString('base64') } },
    ];
  }
  if (!info) throw new Error('PDF が大きく、文字も取り出せませんでした');
  const note = `（全 ${info.pages} ページと長いため、文字だけを読みました${info.readPages < info.pages ? `。${info.readPages} ページ目まで` : ''}。図や表の見た目が必要なら、ページを絞った PDF を添付してください）`;
  return [{ type: 'text', text: `${label}${note}\n${info.text || '（文字がありませんでした。画像だけの PDF かもしれません）'}` }];
}
