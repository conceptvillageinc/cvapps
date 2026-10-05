import JSZip from 'jszip';

// ============================================================================
// 最小限の xlsx 読み取り（Google スプレッドシートを xlsx に書き出したものを読む用）
//   - セルの値（計算済みの値。数式そのものは読まない）
//   - シートに浮かべた画像（どのセルの位置に貼ってあるかと、画像データ）
// ライブラリを増やさないため、ZIP の中の XML を正規表現で読む。
// ============================================================================

const decodeXml = (s) => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

/** <t>…</t> を全部つないで 1 つの文字列にする（書式付き文字列は <r><t> が複数並ぶ） */
function textOf(xml) {
  const parts = [];
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(xml))) parts.push(decodeXml(m[1]));
  return parts.join('');
}

/** "AB12" → { col: 28, row: 12 }（1 始まり） */
export function cellRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

export function colLetter(col) {
  let s = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function parseRels(xml) {
  const rels = {};
  const re = /<Relationship\s([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(xml || ''))) {
    const id = /Id="([^"]+)"/.exec(m[1])?.[1];
    const target = /Target="([^"]+)"/.exec(m[1])?.[1];
    const type = /Type="([^"]+)"/.exec(m[1])?.[1] || '';
    if (id && target) rels[id] = { target: decodeXml(target), type };
  }
  return rels;
}

function resolvePath(baseDir, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = baseDir.split('/').filter(Boolean);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/**
 * xlsx を読む。
 * @param {Buffer|ArrayBuffer} buffer
 * @param {{ withImages?: boolean }} [opts]
 * @returns {Promise<{ sheets: { name, sheetId, cells: Map<string, string|number|boolean>, maxRow, images: { row, col, cx, cy, data: Buffer, ext }[] }[] }>}
 *   cells は "H7" のような参照をキーにした値。row/col は 1 始まり。images の row/col も 1 始まり（貼り付け位置の左上のセル）。
 */
export async function readXlsx(buffer, { withImages = true } = {}) {
  const zip = await JSZip.loadAsync(buffer);
  const text = async (path) => { const f = zip.file(path); return f ? f.async('string') : ''; };

  // 共有文字列
  const sst = [];
  const sstXml = await text('xl/sharedStrings.xml');
  if (sstXml) {
    const re = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(sstXml))) sst.push(textOf(m[1]));
  }

  const wbXml = await text('xl/workbook.xml');
  const wbRels = parseRels(await text('xl/_rels/workbook.xml.rels'));
  const sheets = [];
  const sheetRe = /<sheet\s([^>]*)\/?>/g;
  let sm;
  while ((sm = sheetRe.exec(wbXml))) {
    const attrs = sm[1];
    const name = decodeXml(/name="([^"]*)"/.exec(attrs)?.[1] || '');
    const sheetId = Number(/sheetId="(\d+)"/.exec(attrs)?.[1] || 0);
    const rid = /r:id="([^"]+)"/.exec(attrs)?.[1];
    const target = wbRels[rid]?.target;
    if (!target) continue;
    const sheetPath = resolvePath('xl', target);
    const xml = await text(sheetPath);
    const cells = new Map();
    let maxRow = 0;
    const cRe = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cRe.exec(xml))) {
      const a = cm[1]; const body = cm[2] || '';
      const ref = /r="([A-Z]+\d+)"/.exec(a)?.[1];
      if (!ref) continue;
      const t = /\bt="([^"]+)"/.exec(a)?.[1] || 'n';
      let value = null;
      if (t === 'inlineStr') value = textOf(body);
      else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (v === undefined) continue;
        if (t === 's') value = sst[Number(v)] ?? '';
        else if (t === 'b') value = v === '1';
        else if (t === 'str' || t === 'e') value = decodeXml(v);
        else { const n = Number(v); value = Number.isFinite(n) ? n : decodeXml(v); }
      }
      if (value === null || value === '') continue;
      cells.set(ref, value);
      const r = cellRef(ref); if (r && r.row > maxRow) maxRow = r.row;
    }

    // 画像（図形として浮かべたもの）
    const images = [];
    if (withImages) {
      const dir = sheetPath.slice(0, sheetPath.lastIndexOf('/'));
      const base = sheetPath.slice(sheetPath.lastIndexOf('/') + 1);
      const sRels = parseRels(await text(`${dir}/_rels/${base}.rels`));
      const drawingRel = Object.values(sRels).find((r) => /\/drawing$/.test(r.type));
      if (drawingRel) {
        const drawingPath = resolvePath(dir, drawingRel.target);
        const dXml = await text(drawingPath);
        const dDir = drawingPath.slice(0, drawingPath.lastIndexOf('/'));
        const dBase = drawingPath.slice(drawingPath.lastIndexOf('/') + 1);
        const dRels = parseRels(await text(`${dDir}/_rels/${dBase}.rels`));
        const aRe = /<xdr:(oneCellAnchor|twoCellAnchor|absoluteAnchor)\b[\s\S]*?<\/xdr:\1>/g;
        let am;
        while ((am = aRe.exec(dXml))) {
          const blk = am[0];
          const embed = /r:embed="([^"]+)"/.exec(blk)?.[1];
          if (!embed || !dRels[embed]) continue;
          const col = Number(/<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>/.exec(blk)?.[1] ?? -1) + 1;
          const row = Number(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/.exec(blk)?.[1] ?? -1) + 1;
          const cx = Number(/<xdr:ext cx="(\d+)"/.exec(blk)?.[1] || 0);
          const cy = Number(/<xdr:ext cx="\d+" cy="(\d+)"/.exec(blk)?.[1] || 0);
          const mediaPath = resolvePath(dDir, dRels[embed].target);
          const f = zip.file(mediaPath);
          if (!f) continue;
          const data = await f.async('nodebuffer');
          const ext = (mediaPath.split('.').pop() || 'png').toLowerCase();
          images.push({ row, col, cx, cy, data, ext });
        }
      }
    }
    sheets.push({ name, sheetId, cells, maxRow, images });
  }
  return { sheets };
}
