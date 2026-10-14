import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { ArrowLeftRight } from "lucide-react";

/**
 * 印刷仕様のサイズ入力。タテ・ヨコの数字を入れると「タテ297×ヨコ210mm」の形の文字列にする。
 * 保存される値は文字列なので、PDF・依頼メールにはそのまま出る。
 *
 * - 定型サイズを選ぶだけで入る（保存値は「A4タテ（タテ297×ヨコ210mm）」「A4ヨコ（タテ210×ヨコ297mm）」）
 *   タテ長／ヨコ長は数字の大小で決まり、「入れ替え」でタテとヨコの数字を入れ替える
 * - 「箱・立体」に切り替えると「幅mm×奥行mm×高さmm」
 * - 定型に無いもの（A4変形、可変など）は「文字で入力」で自由に書ける
 * - 以前の「210mm×297mm」（幅×高さ）の形もそのまま読める
 * - 文字だけの値（議事録から書き出した「スリーブに合わせる」など）でも、最初はタテ×ヨコの入力欄を出し、
 *   文字は下に残す。タテ・ヨコを両方入れると数字の形に置きかわる
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

/** ヨコ（幅）とタテ（高さ）から向きを決める（ヨコ < タテ ならタテ）。正方形は空 */
export function orientationOf(w, h) {
  const a = Number(w), b = Number(h);
  if (!a || !b || a === b) return "";
  return a < b ? "タテ" : "ヨコ";
}

const NUM = "(\\d+(?:\\.\\d+)?)";
const X = "\\s*[×xX＊*]\\s*";
// 「タテ297×ヨコ210mm」「タテ297mm×ヨコ210mm」（順番が逆でも可）
const TV_RE = new RegExp(`(タテ|縦|ヨコ|横)\\s*${NUM}\\s*(?:mm)?${X}(タテ|縦|ヨコ|横)\\s*${NUM}\\s*mm`);
// 以前の形「210mm×297mm」（幅×高さ）、箱「幅mm×奥行mm×高さmm」
const DIMS_RE = new RegExp(`${NUM}\\s*mm${X}${NUM}\\s*mm(?:${X}${NUM}\\s*mm)?`);
const isTate = (s) => /タテ|縦/.test(s);

const presetFor = (v, w, h) =>
  SIZE_PRESETS.find((x) => ((String(x.w) === w && String(x.h) === h) || (String(x.w) === h && String(x.h) === w)) && v.startsWith(x.label))?.label || "";

/** 文字列を { w（ヨコ）, h（タテ）, d, preset, text, mode } に分解する。数値形式でなければ text だけ */
export function parseSize(value) {
  const v = String(value || "").trim();
  if (!v) return { w: "", h: "", d: "", preset: "", text: "", mode: "flat" };
  const tv = v.match(TV_RE);
  if (tv && isTate(tv[1]) !== isTate(tv[3])) {
    const h = isTate(tv[1]) ? tv[2] : tv[4];
    const w = isTate(tv[1]) ? tv[4] : tv[2];
    return { w, h, d: "", preset: presetFor(v, w, h), text: "", mode: "flat" };
  }
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
  return { w, h, d, preset: isBox ? "" : presetFor(v, w, h), text: "", mode: isBox ? "box" : "flat" };
}

/** 数字から保存する文字列を組み立てる（未入力があれば空文字） */
export function formatSize({ w, h, d, preset, mode }) {
  const clean = (x) => String(x || "").replace(/[^0-9.]/g, "");
  if (mode === "box") {
    const parts = [clean(w), clean(d), clean(h)];
    if (parts.some((x) => !x)) return "";
    return parts.map((x) => `${x}mm`).join("×");
  }
  if (!clean(w) || !clean(h)) return "";
  const dims = `タテ${clean(h)}×ヨコ${clean(w)}mm`;
  if (preset) return `${preset}${orientationOf(w, h)}（${dims}）`;
  return dims;
}

/** 最初に出す形。文字だけの値でもタテ×ヨコの入力欄を出す（文字は fields.text に残す） */
const initialFields = (value) => {
  const f = parseSize(value);
  return f.mode === "text" ? { ...f, mode: "flat" } : f;
};

export default function SizeInput({ value, onChange, className = "", compact = false }) {
  const [fields, setFields] = useState(() => initialFields(value));
  const [emitted, setEmitted] = useState(value || "");

  // 外から値が変わったとき（過去見積の複製など）は入力欄も追従する
  useEffect(() => {
    if ((value || "") !== emitted) {
      setFields(initialFields(value));
      setEmitted(value || "");
    }
  }, [value]);

  const emit = (next) => {
    const formatted = formatSize(next);
    // タテ×ヨコの途中（片方だけ）のあいだは、前の文字をそのまま保つ
    const str = next.mode === "text" ? next.text : (formatted || next.text || "");
    setFields(next.mode === "flat" && formatted ? { ...next, text: "" } : next);
    setEmitted(str);
    onChange(str);
  };
  const setNum = (key) => (e) => emit({ ...fields, [key]: e.target.value.replace(/[^0-9.]/g, ""), preset: "" });
  // 定型を選んだときは、いまの向きを引き継ぐ（A4 をヨコにしたあと A3 を選んでもヨコのまま）
  const pickPreset = (p) => {
    const keepLandscape = orientationOf(fields.w, fields.h) === "ヨコ";
    const natural = orientationOf(p.w, p.h);
    const flip = keepLandscape ? natural === "タテ" : false;
    emit({ ...fields, mode: "flat", w: String(flip ? p.h : p.w), h: String(flip ? p.w : p.h), d: "", preset: p.label, text: "" });
  };
  const setMode = (mode) => emit({ ...fields, mode, preset: mode === "box" ? "" : fields.preset, text: mode === "text" ? (fields.text || formatSize(fields)) : fields.text });
  // タテとヨコの数字を入れ替える（定型はそのまま。A4タテ ⇄ A4ヨコ）
  const swap = () => emit({ ...fields, w: fields.h, h: fields.w });

  const isBox = fields.mode === "box";
  const isText = fields.mode === "text";
  const result = isText ? fields.text : formatSize(fields);
  const pendingText = !isText && !isBox && !result ? fields.text : "";

  const numBox = (key, label, id) => (
    <label className={`flex items-center ${compact ? "h-8" : "h-9"} rounded-md border bg-background overflow-hidden focus-within:ring-2 focus-within:ring-ring`} title={label}>
      <span className="pl-2 pr-1 text-[10px] text-muted-foreground whitespace-nowrap">{label}</span>
      <input
        id={id}
        inputMode="decimal"
        value={fields[key]}
        onChange={setNum(key)}
        placeholder="000"
        aria-label={label}
        className={`${compact ? "w-11" : "w-14"} h-full text-right text-sm bg-transparent outline-none tabular-nums`}
      />
      <span className="pr-2 pl-0.5 text-[11px] text-muted-foreground">mm</span>
    </label>
  );

  const modes = (
    <div className="flex gap-0.5 p-0.5 rounded-full bg-muted">
      {[["flat", "タテ×ヨコ"], ["box", "箱・立体"], ["text", "文字で入力"]].map(([k, label]) => (
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
  );
  const dims = (
    <>
      {isBox ? (
        <>
          {numBox("w", "幅", "size-w")}
          <span className="text-muted-foreground">×</span>
          {numBox("d", "奥行", "size-d")}
          <span className="text-muted-foreground">×</span>
          {numBox("h", "高さ", "size-h")}
        </>
      ) : (
        <>
          {numBox("h", "タテ", "size-h")}
          <span className="text-muted-foreground">×</span>
          {numBox("w", "ヨコ", "size-w")}
          <button
            type="button"
            onClick={swap}
            disabled={!fields.w || !fields.h || fields.w === fields.h}
            title="タテとヨコの数字を入れ替える"
            className={`${compact ? "h-8" : "h-9"} px-2 rounded-md border bg-background flex items-center gap-1 text-[11px] text-muted-foreground hover:bg-blue-50 hover:text-blue-800 disabled:opacity-40 disabled:hover:bg-background`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" /> 入れ替え
          </button>
        </>
      )}
    </>
  );
  const resultChip = (extra = "") => (
    <span className={`${compact ? "h-8 px-2.5 text-xs" : "h-9 px-3 text-sm"} flex items-center rounded-md font-medium tabular-nums whitespace-nowrap ${result ? "bg-indigo-50 text-slate-800" : "bg-muted text-muted-foreground"} ${extra}`}>
      {result || (isBox ? "000mm×000mm×000mm" : "タテ000×ヨコ000mm")}
    </span>
  );
  const pendingNote = pendingText && (
    <p className="basis-full text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
      いまの内容: <span className="text-slate-700">{pendingText}</span>（タテ・ヨコを入れると置きかわります）
    </p>
  );

  // 詰めた形: 規格はプルダウンにして、規格・入れ方・寸法を 1 行に並べる
  if (compact) {
    return (
      <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
        <select
          value={isText ? "" : fields.preset}
          onChange={(e) => { const p = SIZE_PRESETS.find((x) => x.label === e.target.value); if (p) pickPreset(p); }}
          className="h-8 w-auto shrink-0 rounded-md border bg-background px-2 text-xs"
          aria-label="規格サイズ"
        >
          <option value="">規格</option>
          {SIZE_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
        </select>
        {modes}
        {isText ? (
          <Input value={fields.text} onChange={(e) => emit({ ...fields, text: e.target.value })} placeholder="例: A4変形（210mm×200mm）、可変" className="h-8 min-w-[12rem] flex-1" />
        ) : (
          <>
            {dims}
            {resultChip()}
          </>
        )}
        {pendingNote}
      </div>
    );
  }

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
        {modes}
      </div>

      {isText ? (
        <Input value={fields.text} onChange={(e) => emit({ ...fields, text: e.target.value })} placeholder="例: A4変形（210mm×200mm）、可変" className="h-9" />
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {dims}
          {resultChip("ml-auto")}
          {pendingNote}
        </div>
      )}
    </div>
  );
}
