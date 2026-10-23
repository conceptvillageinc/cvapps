import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { X, Plus, PackageCheck, Tag, History, Shapes } from "lucide-react";
import { usePricingRules } from "@/lib/pricing";
import { PRINT_ITEMS, clientItemHistory, candidatesForItem } from "@/lib/printItems";
import { masterCellPrice, masterCellToItem, orderToItems, pastLineToItem } from "@/lib/lineSources";
import { isImeEnter } from "@/lib/ime";

const yen = (n) => (n === null || n === undefined || n === "" ? "—" : `¥${(Number(n) || 0).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}`);
const ymd = (s) => String(s || "").replace(/-/g, "/");
const qtyText = (q, u) => (q != null && q !== "" ? `${Number(q).toLocaleString()}${u || ""}` : "");
const KIND = {
  order: { label: "前回の入稿", icon: PackageCheck, cls: "text-teal-700" },
  master: { label: "価格マスタ", icon: Tag, cls: "text-emerald-700" },
  line: { label: "過去見積", icon: History, cls: "text-sky-700" },
};

/**
 * 新規見積作成の「作るもの」。
 *   品目（ポスター・チラシ …）をチップで選ぶと、品目ごとに前回の入稿・価格マスタ・過去見積の明細の候補を出す。
 *   チェックした候補は、作成したときにはじめから明細に入る。件名が「販促ツール一式」のように広くても、中身で探せる。
 *   クライアントを選んでいれば「このクライアントで前に作ったもの」を回数つきで出し、押すとチップに足す。
 * @param {object} p
 * @param {string} p.clientName
 * @param {{ masters, orders, estimates }} p.data
 * @param {(lines: object[]) => void} p.onLinesChange
 */
export default function ItemChips({ clientName, data, onLinesChange }) {
  const { rules } = usePricingRules();
  const [chips, setChips] = useState([]);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState({}); // 候補 id → true
  const [cellOf, setCellOf] = useState({}); // 価格マスタの候補 id → 選んだセルの番号

  const history = useMemo(() => clientItemHistory(clientName, data), [clientName, data]);
  const candidates = useMemo(() => Object.fromEntries(chips.map((chip) => [chip, candidatesForItem(chip, clientName, data)])), [chips, clientName, data]);

  const addChip = (chip) => {
    const k = String(chip || "").trim();
    if (!k || chips.includes(k)) return;
    setChips((cs) => [...cs, k]);
    // このクライアントの前回の分があれば、最初からチェックを入れておく
    const first = candidatesForItem(k, clientName, data).find((x) => x.sameClient);
    if (first) setPicked((p) => ({ ...p, [first.id]: true }));
  };
  const removeChip = (chip) => {
    setChips((cs) => cs.filter((x) => x !== chip));
    const ids = new Set((candidates[chip] || []).map((x) => x.id));
    setPicked((p) => Object.fromEntries(Object.entries(p).filter(([id]) => !ids.has(id))));
  };

  // チェックした候補 → 明細
  const lines = useMemo(() => {
    const out = [];
    for (const chip of chips) {
      for (const cand of candidates[chip] || []) {
        if (!picked[cand.id]) continue;
        if (cand.kind === "order") {
          const all = orderToItems(cand.order);
          out.push(...(cand.itemIndex != null ? [all[cand.itemIndex]].filter(Boolean) : all));
        } else if (cand.kind === "master") {
          out.push(masterCellToItem(cand.entry, cand.cells[cellOf[cand.id] ?? 0] || cand.cell, rules));
        } else {
          out.push(pastLineToItem(cand.line, cand.estimate));
        }
      }
    }
    return out;
  }, [chips, candidates, picked, cellOf, rules]);
  // 一度も選んでいないうちは何もしない（ほかから入れた明細を消さない）
  const touched = useRef(false);
  useEffect(() => {
    if (lines.length === 0 && !touched.current) return;
    touched.current = true;
    onLinesChange(lines);
  }, [lines]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggestions = PRINT_ITEMS.map((it) => it.key).filter((k) => !chips.includes(k) && !history.some((h) => h.key === k));

  return (
    <div className="space-y-2" data-testid="item-chips">
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((chip) => (
          <span key={chip} className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium" data-testid="item-chip">
            {chip}
            <button type="button" onClick={() => removeChip(chip)} className="hover:text-foreground" aria-label={`${chip} を外す`}><X className="w-3 h-3" /></button>
          </span>
        ))}
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if ((e.key === "Enter" && !isImeEnter(e))) { e.preventDefault(); addChip(text); setText(""); } }}
          placeholder={chips.length ? "品目を足す（Enter）" : "作る品目を入れて Enter（例: ポスター・のぼり）。下の候補からも選べます"}
          className="h-8 flex-1 min-w-[200px] text-xs"
          aria-label="作るものを足す"
          data-testid="item-chip-input"
        />
      </div>

      {history.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-[11px]" data-testid="client-history">
          <span className="text-muted-foreground mr-0.5">このクライアントで前に作ったもの:</span>
          {history.map((h) => (
            <button key={h.key} type="button" disabled={chips.includes(h.key)} onClick={() => addChip(h.key)} className="inline-flex items-center gap-0.5 rounded-full border border-teal-300 bg-teal-50 px-2 leading-5 text-teal-900 hover:bg-teal-100 disabled:opacity-40" title={`最後 ${ymd(h.last)}`}>
              <Plus className="w-3 h-3" /> {h.key} <span className="text-teal-700/80">{h.count}回</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        <span className="text-muted-foreground mr-0.5">ほかの品目:</span>
        {suggestions.slice(0, 12).map((k) => (
          <button key={k} type="button" onClick={() => addChip(k)} className="inline-flex items-center gap-0.5 rounded-full border px-2 leading-5 text-muted-foreground hover:bg-muted/50"><Plus className="w-3 h-3" /> {k}</button>
        ))}
      </div>

      {chips.length > 0 && (
        <div className="rounded-md border divide-y" data-testid="item-candidates">
          {chips.map((chip) => {
            const list = candidates[chip] || [];
            return (
              <div key={chip} className="px-3 py-2 space-y-1">
                <p className="text-xs font-semibold flex items-center gap-1"><Shapes className="w-3.5 h-3.5 text-primary" /> {chip}<span className="text-[10px] font-normal text-muted-foreground">（候補 {list.length}）</span></p>
                {list.length === 0 && <p className="text-[11px] text-muted-foreground">過去の入稿・価格マスタ・過去見積に見つかりませんでした。作成後に明細で入れてください</p>}
                {list.map((cand) => {
                  const K = KIND[cand.kind];
                  const Icon = K.icon;
                  const master = cand.kind === "master";
                  const cell = master ? cand.cells[cellOf[cand.id] ?? 0] || cand.cell : null;
                  const mp = master ? masterCellPrice(cand.entry, cell, rules) : null;
                  return (
                    <label key={cand.id} className={`flex items-center gap-2 rounded px-1.5 py-1 text-[11.5px] cursor-pointer hover:bg-muted/40 ${picked[cand.id] ? "bg-primary/5" : ""}`} data-testid="item-candidate">
                      <Checkbox checked={!!picked[cand.id]} onCheckedChange={(v) => setPicked((p) => ({ ...p, [cand.id]: !!v }))} aria-label={`${cand.title} を明細に入れる`} />
                      <span className={`inline-flex items-center gap-0.5 w-[78px] shrink-0 text-[10px] ${K.cls}`}><Icon className="w-3 h-3" /> {K.label}</span>
                      <span className="tabular-nums text-muted-foreground w-[72px] shrink-0">{ymd(cand.date)}</span>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{cand.title}</span>
                        <span className="text-muted-foreground">　{[cand.sub, cand.client && `${cand.client}${cand.sameClient ? "（同じクライアント）" : ""}`].filter(Boolean).join("・")}</span>
                      </span>
                      {master ? (
                        <>
                          <select value={cellOf[cand.id] ?? 0} onClick={(e) => e.stopPropagation()} onChange={(e) => setCellOf((m) => ({ ...m, [cand.id]: Number(e.target.value) }))} className="h-6 rounded border bg-white px-1 text-[10.5px]" aria-label="数量・納期">
                            {cand.cells.map((x, i) => <option key={i} value={i}>{Number(x.quantity).toLocaleString()}・{x.label}</option>)}
                          </select>
                          <span className="tabular-nums shrink-0 w-24 text-right">出し値 <b>{yen(mp.price)}</b></span>
                        </>
                      ) : (
                        <span className="tabular-nums shrink-0 text-right">{qtyText(cand.quantity, cand.unit)}{cand.unit_price != null ? ` × ${yen(cand.unit_price)}` : ""} ＝ <b>{yen(cand.amount)}</b></span>
                      )}
                    </label>
                  );
                })}
              </div>
            );
          })}
          <p className="px-3 py-1.5 text-[11px] bg-muted/30">{lines.length ? <>チェックした <b>{lines.length} 行</b>を、作成したときにはじめから明細に入れます（数量・単価は作成後に直せます）</> : "チェックした候補は、作成したときにはじめから明細に入ります"}</p>
        </div>
      )}
    </div>
  );
}
