// ============================================================================
// Excel（.xlsx）をブラウザで読む（工程表の読み取り用。値とセルの塗りの色だけ）
//   日付の書式のセルは YYYY-MM-DD にする。塗りは #rrggbb（白・塗りなしは null）
//   条件付き書式の色は読めない（その場合は開始日・終了日の列から読む）
// ============================================================================
import JSZip from "jszip";

const colIndex = (letters) => letters.split("").reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
const parse = (xml) => new DOMParser().parseFromString(xml, "application/xml");
const byTag = (node, tag) => Array.from(node.getElementsByTagName(tag));
const DATE_FMT_IDS = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function serialToYmd(n) {
  const ms = Math.round((Number(n) - 25569) * 86400000); // 1970-01-01 = 25569
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function themeColors(xml) {
  if (!xml) return [];
  const doc = parse(xml);
  const scheme = byTag(doc, "a:clrScheme")[0];
  if (!scheme) return [];
  const pick = (name) => {
    const el = byTag(scheme, `a:${name}`)[0];
    const c = el && (byTag(el, "a:srgbClr")[0]?.getAttribute("val") || byTag(el, "a:sysClr")[0]?.getAttribute("lastClr"));
    return c ? `#${c.toLowerCase()}` : null;
  };
  // Excel のテーマ番号の並び: lt1, dk1, lt2, dk2, accent1〜6, hlink, folHlink
  return ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"].map((n) => pick(n.replace("lt1", "lt1")));
}

function colorOf(el, theme) {
  if (!el) return null;
  const rgb = el.getAttribute("rgb");
  if (rgb) return `#${rgb.slice(-6).toLowerCase()}`;
  const t = el.getAttribute("theme");
  if (t != null) return theme[Number(t)] || null;
  return null;
}
const isWhite = (hex) => !hex || /^#(ffffff|fefefe|fdfdfd)$/i.test(hex);

/**
 * @param {File|ArrayBuffer} file
 * @returns {Promise<{ sheets: Array<{ name: string, rows: string[][], fills: (string|null)[][] }> }>}
 */
export async function readXlsx(file, { maxRows = 300, maxCols = 200 } = {}) {
  const zip = await JSZip.loadAsync(file instanceof ArrayBuffer ? file : await file.arrayBuffer());
  const text = async (path) => (zip.file(path) ? zip.file(path).async("string") : null);

  const shared = [];
  const ss = await text("xl/sharedStrings.xml");
  if (ss) for (const si of byTag(parse(ss), "si")) shared.push(byTag(si, "t").map((t) => t.textContent).join(""));

  const theme = themeColors(await text("xl/theme/theme1.xml"));
  const styles = parse((await text("xl/styles.xml")) || "<styleSheet/>");
  const customDate = new Set();
  for (const f of byTag(styles, "numFmt")) {
    const code = (f.getAttribute("formatCode") || "").replace(/"[^"]*"|\[[^\]]*\]/g, "");
    if (/[ymd]/i.test(code) && !/^[hms:.\s0]+$/i.test(code)) customDate.add(Number(f.getAttribute("numFmtId")));
  }
  const fills = byTag(byTag(styles, "fills")[0] || styles, "fill").map((f) => {
    const p = byTag(f, "patternFill")[0];
    if (!p || p.getAttribute("patternType") === "none") return null;
    const c = colorOf(byTag(p, "fgColor")[0], theme) || colorOf(byTag(p, "bgColor")[0], theme);
    return isWhite(c) ? null : c;
  });
  const xfs = byTag(byTag(styles, "cellXfs")[0] || styles, "xf").map((x) => ({
    date: (() => { const id = Number(x.getAttribute("numFmtId") || 0); return DATE_FMT_IDS.has(id) || customDate.has(id); })(),
    fill: fills[Number(x.getAttribute("fillId") || 0)] || null,
  }));

  const wb = parse((await text("xl/workbook.xml")) || "<workbook/>");
  const rels = parse((await text("xl/_rels/workbook.xml.rels")) || "<Relationships/>");
  const relTarget = new Map(byTag(rels, "Relationship").map((r) => [r.getAttribute("Id"), r.getAttribute("Target")]));
  const out = [];
  for (const sh of byTag(wb, "sheet")) {
    if (sh.getAttribute("state") === "hidden") continue;
    const rid = sh.getAttribute("r:id") || sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    let target = relTarget.get(rid) || "";
    target = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const xml = await text(target);
    if (!xml) continue;
    const doc = parse(xml);
    const rows = []; const fillRows = [];
    for (const c of byTag(doc, "c")) {
      const m = /^([A-Z]+)(\d+)$/.exec(c.getAttribute("r") || "");
      if (!m) continue;
      const ci = colIndex(m[1]); const ri = Number(m[2]) - 1;
      if (ri >= maxRows || ci >= maxCols) continue;
      const xf = xfs[Number(c.getAttribute("s") || 0)] || {};
      const t = c.getAttribute("t");
      const v = byTag(c, "v")[0]?.textContent;
      let value = "";
      if (t === "s") value = shared[Number(v)] ?? "";
      else if (t === "inlineStr") value = byTag(c, "t").map((x) => x.textContent).join("");
      else if (t === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (v != null) value = xf.date && !Number.isNaN(Number(v)) ? serialToYmd(v) : v;
      (rows[ri] ||= [])[ci] = String(value);
      if (xf.fill) (fillRows[ri] ||= [])[ci] = xf.fill;
    }
    const height = Math.max(rows.length, fillRows.length);
    const norm = (arr) => Array.from({ length: height }, (_, i) => Array.from(arr[i] || [], (x) => x ?? (arr === rows ? "" : null)));
    out.push({ name: sh.getAttribute("name") || `シート${out.length + 1}`, rows: norm(rows), fills: norm(fillRows) });
  }
  return { sheets: out };
}
