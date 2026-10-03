import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UserPlus, Check } from "lucide-react";

// ============================================================================
// クライアント名の入力欄（部分一致で候補を出す）
//   「中澤」と打てば「中澤水産有限会社」が候補に出る。フリガナ・法人格の有無・空白・全角半角の違いは無視。
//   候補を選ぶと正式な名前が入り、一覧に無い名前のときだけ「新規登録」を促す。
// ============================================================================

/** 比較用にそろえる: 全角→半角、小文字、ひらがな→カタカナ、空白と法人格（漢字・かな表記）を除く */
export function normalizeClientName(s) {
  return String(s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/\s+/g, "")
    .replace(/株式会社|有限会社|合同会社|合資会社|一般社団法人|社会福祉法人|医療法人|学校法人|\(株\)|\(有\)|㈱|㈲|（株）|（有）|カブシキガイシャ|カブシキカイシャ|ユウゲンガイシャ|ユウゲンカイシャ|ゴウドウガイシャ|ゴウドウカイシャ/g, "");
}

/** 部分一致で候補を絞る（名前の先頭一致 → 名前の部分一致 → フリガナの順） */
export function matchClients(clients, text, limit = 8) {
  const q = normalizeClientName(text);
  if (!q) return clients.slice(0, limit);
  const scored = [];
  for (const c of clients) {
    const n = normalizeClientName(c.name);
    const k = normalizeClientName(c.name_kana);
    let score = -1;
    if (n === q) score = 0;
    else if (n.startsWith(q)) score = 1;
    else if (n.includes(q)) score = 2;
    else if (k && k.includes(q)) score = 3;
    if (score >= 0) scored.push({ c, score });
  }
  return scored.sort((a, b) => a.score - b.score || String(a.c.name).localeCompare(String(b.c.name), "ja")).slice(0, limit).map((x) => x.c);
}

function Highlight({ text, query }) {
  const q = String(query || "").trim();
  if (!q) return text;
  const i = String(text).toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark className="bg-yellow-100 text-inherit rounded-sm">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

/**
 * @param {object} p
 * @param {string} p.value             入力中の名前
 * @param {(name:string)=>void} p.onChange
 * @param {object[]} p.clients         クライアント一覧（name, name_kana, contact_person）
 * @param {()=>void} [p.onRegister]    「新規登録」を押したとき（渡さなければボタンを出さない）
 * @param {string} [p.registerHint]    新規登録の案内文
 * @param {boolean} [p.required]
 */
export default function ClientCombobox({ value, onChange, clients, onRegister, registerHint, placeholder = "クライアント名で検索", className = "", inputClassName = "h-10", disabled = false, autoFocus = false }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const text = String(value || "");
  const unique = useMemo(() => [...new Map((clients || []).map((c) => [c.name, c])).values()], [clients]);
  const candidates = useMemo(() => matchClients(unique, text), [unique, text]);
  const exact = useMemo(() => unique.find((c) => c.name === text.trim()) || null, [unique, text]);

  useEffect(() => { setActive(0); }, [text]);
  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (c) => { onChange(c.name); setOpen(false); };
  const onKeyDown = (e) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { setOpen(true); return; }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(candidates.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { if (candidates[active]) { e.preventDefault(); pick(candidates[active]); } }
    else if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
  };
  const showList = open && !disabled && candidates.length > 0 && !(exact && candidates.length === 1);
  const noMatch = text.trim() && candidates.length === 0;

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <Input
        value={text}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={inputClassName}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-label="クライアント"
      />
      {showList && (
        <ul className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-auto rounded-md border bg-popover shadow-md text-sm py-1" role="listbox">
          {candidates.map((c, i) => (
            <li
              key={c.id || c.name}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}
              onMouseEnter={() => setActive(i)}
              className={`px-3 py-1.5 cursor-pointer flex items-center gap-2 ${i === active ? "bg-accent" : ""}`}
            >
              <Check className={`w-3.5 h-3.5 shrink-0 ${c.name === text.trim() ? "opacity-100" : "opacity-0"}`} />
              <span className="truncate"><Highlight text={c.name} query={text.trim()} /></span>
              {c.contact_person && <span className="ml-auto text-[11px] text-muted-foreground truncate max-w-[40%]">{c.contact_person}</span>}
            </li>
          ))}
        </ul>
      )}
      {exact ? (
        <p className="text-[11px] text-emerald-700 mt-1">クライアント一覧の「{exact.name}」に紐づきます</p>
      ) : noMatch ? (
        <div className="mt-1 flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          <span>「{text.trim()}」はクライアント一覧にありません。</span>
          {onRegister && (
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1 bg-white" onClick={onRegister}><UserPlus className="w-3.5 h-3.5" /> クライアント一覧に新規登録する</Button>
          )}
          {registerHint && <span className="text-[11px] text-amber-700">{registerHint}</span>}
        </div>
      ) : text.trim() ? (
        <p className="text-[11px] text-muted-foreground mt-1">候補から選ぶと正式な名前が入ります（{candidates.length} 件）</p>
      ) : null}
    </div>
  );
}
