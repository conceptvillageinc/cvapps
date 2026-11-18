// ============================================================================
// Claude の回答（Markdown）を表示する小さな部品。HTML は使わず React の要素だけで組む（安全のため）
//   見出し（#）・太字（**）・斜体（*）・コード（` と ```）・箇条書き（- / 1.）・表（| a | b |）・区切り線（---）・リンク
// ============================================================================

function inline(text, keyBase = "i") {
  const out = [];
  // **太字**・`コード`・[文字](URL)・*斜体*
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|\*[^*\s][^*]*\*)/g;
  let last = 0; let m; let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={`${keyBase}${k++}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={`${keyBase}${k++}`} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em]">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const label = t.slice(1, t.indexOf("]"));
      // 数字だけのリンク（[1](URL)）は、Web の引用元の番号として小さな丸で出す
      if (/^\d+$/.test(label)) out.push(<a key={`${keyBase}${k++}`} href={m[2]} target="_blank" rel="noreferrer" title={m[2]} className="mx-0.5 inline-flex h-4 min-w-4 -translate-y-0.5 items-center justify-center rounded-full bg-primary/10 px-1 align-middle text-[10px] font-bold text-primary no-underline hover:bg-primary/20" data-testid="cite">{label}</a>);
      else out.push(<a key={`${keyBase}${k++}`} href={m[2]} target="_blank" rel="noreferrer" className="text-primary underline">{label}</a>);
    }
    else out.push(<em key={`${keyBase}${k++}`}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export default function MiniMarkdown({ text = "", className = "" }) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const body = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) { body.push(lines[i]); i += 1; }
      i += 1;
      blocks.push(<pre key={blocks.length} className="overflow-x-auto rounded-md bg-slate-900 p-3 text-[12px] leading-relaxed text-slate-100"><code>{body.join("\n")}</code></pre>);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i += 1; }
      blocks.push(
        <div key={blocks.length} className="overflow-x-auto">
          <table className="min-w-full border-collapse text-[12.5px]">
            <thead><tr>{head.map((h, k) => <th key={k} className="border bg-slate-50 px-2 py-1 text-left font-semibold whitespace-nowrap">{inline(h, `h${k}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, k) => <td key={k} className={`border px-2 py-1 align-top ${/^[-¥\d,.%（）()税込抜円 ]+$/.test(c) ? "text-right tabular-nums whitespace-nowrap" : ""}`}>{inline(c, `c${ri}${k}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const size = { 1: "text-base", 2: "text-[15px]", 3: "text-sm", 4: "text-sm" }[h[1].length];
      blocks.push(<p key={blocks.length} className={`${size} font-bold pt-1`}>{inline(h[2])}</p>);
      i += 1; continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { blocks.push(<hr key={blocks.length} className="my-1" />); i += 1; continue; }
    if (/^\s*([-*・]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*・]|\d+[.)])\s+/.test(lines[i])) {
        const depth = Math.min(3, Math.floor((lines[i].match(/^\s*/)[0].length) / 2));
        items.push({ depth, text: lines[i].replace(/^\s*([-*・]|\d+[.)])\s+/, "") });
        i += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={blocks.length} className={`${ordered ? "list-decimal" : "list-disc"} space-y-0.5 pl-5`}>{items.map((it, k) => <li key={k} style={{ marginLeft: it.depth * 16 }}>{inline(it.text, `l${k}`)}</li>)}</List>);
      continue;
    }
    if (!line.trim()) { i += 1; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*・]|\d+[.)])\s+|\s*\|.*\|\s*$)/.test(lines[i])) { para.push(lines[i]); i += 1; }
    blocks.push(<p key={blocks.length} className="whitespace-pre-wrap">{inline(para.join("\n"))}</p>);
  }
  return <div className={`space-y-2 text-sm leading-relaxed ${className}`}>{blocks}</div>;
}
