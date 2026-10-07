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

