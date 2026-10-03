import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { RectangleVertical, RectangleHorizontal } from "lucide-react";

/**
 * 印刷仕様のサイズ入力。数字だけ入れると「210mm×297mm」の形の文字列にする。
 * 保存される値は今まで通りの文字列なので、既存データ・PDF・依頼メールはそのまま使える。
 *
 * - 定型サイズはチップを押すだけ（保存値は「A4タテ（210mm×297mm）」「A4ヨコ（297mm×210mm）」）
 *   タテ／ヨコは幅と高さの大小で決まり、切り替えると幅と高さが入れ替わる
 * - 「箱・立体」に切り替えると奥行が増えて「幅mm×奥行mm×高さmm」
 * - 定型に無いもの（A4変形、可変など）は「文字で入力」で自由に書ける
 */
export const SIZE_PRESETS = [
  { label: "A4", w: 210, h: 297 },
  { label: "A3", w: 297, h: 420 },
  { label: "A5", w: 148, h: 210 },
  { label: "A6", w: 105, h: 148 },
  { label: "B5", w: 182, h: 257 },
  { label: "B4", w: 257, h: 364 },
  { label: "ハガキ", w: 100, h: 148 },
  { label: "名刺", w: 91, h: 55 },
  { label: "長3封筒", w: 120, h: 235 },
  { label: "角2封筒", w: 240, h: 332 },
];

/** 幅と高さから向きを決める（幅 < 高さ ならタテ）。正方形は空 */
export function orientationOf(w, h) {
  const a = Number(w), b = Number(h);
  if (!a || !b || a === b) return "";
  return a < b ? "タテ" : "ヨコ";
}

const NUM = "(\\d+(?:\\.\\d+)?)";
const DIMS_RE = new RegExp(`${NUM}\\s*mm\\s*[×xX＊*]\\s*${NUM}\\s*mm(?:\\s*[×xX＊*]\\s*${NUM}\\s*mm)?`);

/** 文字列を { w, h, d, preset, text } に分解する。数値形式でなければ text だけ */
export function parseSize(value) {
  const v = String(value || "").trim();
  if (!v) return { w: "", h: "", d: "", preset: "", text: "", mode: "flat" };
  const m = v.match(DIMS_RE);
  if (!m) {
    // 「A4」「A4ヨコ」のように寸法が無い場合
    const pm = v.match(/^(.+?)(タテ|ヨコ|縦|横)?$/);
    const p = SIZE_PRESETS.find((x) => x.label === (pm ? pm[1] : v));
    if (p) {
      const landscape = pm && /ヨコ|横/.test(pm[2] || "");
      const natural = orientationOf(p.w, p.h);
      const flip = landscape ? natural === "タテ" : (pm && /タテ|縦/.test(pm[2] || "") ? natural === "ヨコ" : false);
      return { w: String(flip ? p.h : p.w), h: String(flip ? p.w : p.h), d: "", preset: p.label, text: "", mode: "flat" };
    }
    return { w: "", h: "", d: "", preset: "", text: v, mode: "text" };
  }
  const isBox = m[3] != null;
  const w = m[1], h = isBox ? m[3] : m[2], d = isBox ? m[2] : "";
  // 定型は寸法が合えば向きがどちらでも同じ定型（A4ヨコ＝297×210 も A4）
  const preset = !isBox
    ? (SIZE_PRESETS.find((x) => ((String(x.w) === w && String(x.h) === h) || (String(x.w) === h && String(x.h) === w)) && v.startsWith(x.label))?.label || "")
    : "";
  return { w, h, d, preset, text: "", mode: isBox ? "box" : "flat" };
}

/** 数字から保存する文字列を組み立てる（未入力があれば空文字） */
export function formatSize({ w, h, d, preset, mode }) {
  const clean = (x) => String(x || "").replace(/[^0-9.]/g, "");
  const parts = mode === "box" ? [clean(w), clean(d), clean(h)] : [clean(w), clean(h)];
  if (parts.some((x) => !x)) return "";
  const dims = parts.map((x) => `${x}mm`).join("×");
  if (preset && mode !== "box") return `${preset}${orientationOf(w, h)}（${dims}）`;
  return dims;
}

export default function SizeInput({ value, onChange, className = "" }) {
  const [fields, setFields] = useState(() => parseSize(value));
  const [emitted, setEmitted] = useState(value || "");

  // 外から値が変わったとき（過去見積の複製など）は入力欄も追従する
  useEffect(() => {
    if ((value || "") !== emitted) {
      setFields(parseSize(value));
      setEmitted(value || "");
    }
  }, [value]);

  const emit = (next) => {
    setFields(next);
    const str = next.mode === "text" ? next.text : formatSize(next);
    setEmitted(str);
    onChange(str);
  };
  const setNum = (key) => (e) => emit({ ...fields, [key]: e.target.value.replace(/[^0-9.]/g, ""), preset: "" });
  // 定型を押したときは、いま選んでいる向きを引き継ぐ（A4 を押してからヨコにしたあと A3 を押しても横のまま）
  const pickPreset = (p) => {
    const keepLandscape = orientationOf(fields.w, fields.h) === "ヨコ";
    const natural = orientationOf(p.w, p.h);
    const flip = keepLandscape ? natural === "タテ" : false;
    emit({ ...fields, mode: "flat", w: String(flip ? p.h : p.w), h: String(flip ? p.w : p.h), d: "", preset: p.label, text: "" });
  };
  const setMode = (mode) => emit({ ...fields, mode, preset: mode === "box" ? "" : fields.preset, text: mode === "text" ? (fields.text || formatSize(fields)) : "" });
  // タテ／ヨコの切り替え: 幅と高さを入れ替える（定型はそのまま）
  const setOrientation = (o) => { if (orientationOf(fields.w, fields.h) !== o) emit({ ...fields, w: fields.h, h: fields.w }); };

  const isBox = fields.mode === "box";
  const isText = fields.mode === "text";
  const result = isText ? fields.text : formatSize(fields);
  const orientation = orientationOf(fields.w, fields.h);

  const numBox = (key, label, id) => (
    <label className="flex items-center h-9 rounded-md border bg-background overflow-hidden focus-within:ring-2 focus-within:ring-ring" title={label}>
      <span className="pl-2 pr-1 text-[10px] text-muted-foreground whitespace-nowrap">{label}</span>
      <input
        id={id}
        inputMode="decimal"
        value={fields[key]}
        onChange={setNum(key)}
        placeholder="000"
        className="w-14 h-full text-right text-sm bg-transparent outline-none tabular-nums"
      />
      <span className="pr-2 pl-0.5 text-[11px] text-muted-foreground">mm</span>
    </label>
  );

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-1">
        {SIZE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => pickPreset(p)}
            className={`h-7 px-2.5 rounded-full border text-[11px] transition-colors ${fields.preset === p.label && !isText ? "bg-slate-800 text-white border-slate-800" : "bg-background hover:bg-muted"}`}
          >
            {p.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <div className="flex gap-0.5 p-0.5 rounded-full bg-muted">
          {[["flat", "幅×高さ"], ["box", "箱・立体"], ["text", "文字で入力"]].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMode(k)}
              className={`h-6 px-2.5 rounded-full text-[11px] ${fields.mode === k ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {isText ? (
        <Input value={fields.text} onChange={(e) => emit({ ...fields, text: e.target.value })} placeholder="例: A4変形（210mm×200mm）、可変" className="h-9" />
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {numBox("w", "幅", "size-w")}
          <span className="text-muted-foreground">×</span>
          {isBox && (
            <>
              {numBox("d", "奥行", "size-d")}
              <span className="text-muted-foreground">×</span>
            </>
          )}
          {numBox("h", "高さ", "size-h")}
          {!isBox && (
            <div className="flex gap-0.5 p-0.5 rounded-md bg-muted" role="group" aria-label="向き">
              {[["タテ", RectangleVertical], ["ヨコ", RectangleHorizontal]].map(([o, Icon]) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOrientation(o)}
                  disabled={!fields.w || !fields.h || fields.w === fields.h}
                  aria-pressed={orientation === o}
                  title={o === "タテ" ? "タテ（幅 < 高さ）" : "ヨコ（幅 > 高さ）"}
                  className={`h-8 px-2 rounded flex items-center gap-1 text-[11px] disabled:opacity-40 ${orientation === o ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Icon className="w-3.5 h-3.5" /> {o}
                </button>
              ))}
            </div>
          )}
          <span className={`ml-auto h-9 flex items-center px-3 rounded-md text-sm font-medium tabular-nums whitespace-nowrap ${result ? "bg-indigo-50 text-slate-800" : "bg-muted text-muted-foreground"}`}>
            {result || (isBox ? "000mm×000mm×000mm" : "000mm×000mm")}
          </span>
        </div>
      )}
    </div>
  );
}
