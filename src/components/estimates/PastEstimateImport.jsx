import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Loader2, History, ExternalLink, Copy } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
// 原価は1枚あたりで小数になることがある（例: 8.5円）
const yenCost = (n) => `¥${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString()}`;

/**
 * 過去の見積の明細を検索して、この見積に複製する。
 * 既定は同一クライアントの見積だけ。切り替えで全クライアントに広げられる。
 *
 * props: estimate（現在の見積）, onAdd(items), onClose()
 */
export default function PastEstimateImport({ estimate, onAdd, onClose }) {
  const [allClients, setAllClients] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState(new Set()); // `${estimateId}:${lineId}`

  const { data: estimates = [], isLoading } = useQuery({
    queryKey: ["pastEstimates", allClients ? "all" : estimate.client_name],
    queryFn: () => allClients
      ? db.entities.Estimate.list("-created_date", 500)
      : db.entities.Estimate.filter({ client_name: estimate.client_name }, "-created_date", 200),
  });

  const { data: masters = [] } = useQuery({
    queryKey: ["priceMaster"],
    queryFn: () => db.entities.PriceMaster.list("-last_updated"),
  });
  const masterById = useMemo(() => Object.fromEntries(masters.map((m) => [m.id, m])), [masters]);

  // 入稿先（印刷所 or URL）を明細から割り出す
  const sourceOf = (li) => {
    if (li.source_type === "price_master") {
      const m = masterById[li.source_ref];
      return { label: m?.vendor_name || "価格マスタ", url: li.source_url || m?.source_url || null };
    }
    if (li.source_type === "vendor_quote") return { label: li.source_ref || "仕入先見積", url: null };
    if (li.source_type === "design_master") return { label: "デザイン費マスタ", url: null };
    if (li.source_type === "rule") return { label: "自動計算", url: null };
    return { label: li.outsourcing_kind ? "外注" : "手入力", url: null };
  };

  // 見積ごとに、複製できる明細（テキスト行・自動計算行を除く）を並べる
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = [];
    for (const e of estimates) {
      if (e.id === estimate.id) continue;
      let items = [];
      if (e.schema_version === 2) {
        items = (e.line_items || []).filter((li) => li.row_type !== "text" && li.source_type !== "rule");
      } else if (e.selling_price > 0) {
        // 旧形式: 印刷費1行として扱う
        const qty = (e.quantities || [])[0] || 1;
        items = [{
          id: "legacy",
          category: "印刷費（紙）",
          name: `${e.print_type || "印刷費"}${e.selected_vendor ? `（${e.selected_vendor}）` : ""}`,
          quantity: qty, unit: "枚",
          unit_price: Math.round(Number(e.selling_price) / qty), amount: Number(e.selling_price),
          cost_price: e.cost_price ? Math.round((Number(e.cost_price) / qty) * 100) / 100 : null,
          markup_rate: e.markup_rate || null,
          source_type: "manual", source_ref: e.selected_vendor || undefined,
        }];
      }
      const hay = `${e.estimate_number} ${e.client_name} ${e.estimate_title || ""}`.toLowerCase();
      const filtered = items.filter((li) => !q || hay.includes(q) || String(li.name || "").toLowerCase().includes(q));
      if (filtered.length > 0) out.push({ estimate: e, items: filtered });
    }
    return out;
  }, [estimates, estimate.id, search]);

  const key = (e, li) => `${e.id}:${li.id}`;
  const toggle = (k) => setPicked((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleGroup = (g) => setPicked((prev) => {
    const n = new Set(prev);
    const keys = g.items.map((li) => key(g.estimate, li));
    const all = keys.every((k) => n.has(k));
    keys.forEach((k) => (all ? n.delete(k) : n.add(k)));
    return n;
  });

  const submit = () => {
    const items = [];
    for (const g of groups) {
      for (const li of g.items) {
        if (!picked.has(key(g.estimate, li))) continue;
        // id は追加側で振り直す。複製元を残す。
        const { id: _id, ...rest } = li;
        items.push({ ...rest, copied_from: g.estimate.estimate_number, copied_from_id: g.estimate.id });
      }
    }
    if (items.length === 0) { toast.error("複製する明細を選んでください"); return; }
    onAdd(items);
    toast.success(`${items.length}件の明細を複製しました。数量や単価は必要に応じて直してください`);
    onClose();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="見積番号・件名・明細名で絞り込み" className="h-9 pl-8 text-xs" />
        </div>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer shrink-0">
          <Checkbox checked={allClients} onCheckedChange={(v) => { setAllClients(!!v); setPicked(new Set()); }} />
          他のクライアントの見積も含む
        </label>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {allClients ? "すべてのクライアント" : `「${estimate.client_name}」`}の見積から、明細を選んで複製します。前回の原価・売価・入稿先がそのまま入ります。
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : groups.length === 0 ? (
        <div className="text-center py-10">
          <History className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">
            {allClients ? "該当する明細がありません" : "このクライアントの過去見積に明細がありません。「他のクライアントの見積も含む」で広げられます"}
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
          {groups.map((g) => {
            const e = g.estimate;
            const allOn = g.items.every((li) => picked.has(key(e, li)));
            return (
              <div key={e.id} className="border rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 text-xs">
                  <Checkbox checked={allOn} onCheckedChange={() => toggleGroup(g)} />
                  <span className="font-mono text-muted-foreground">{e.estimate_number}</span>
                  <span className="text-muted-foreground">{e.created_date ? format(new Date(e.created_date), "yyyy/M/d") : ""}</span>
                  {allClients && <span className="font-medium truncate">{e.client_name}</span>}
                  <span className="truncate flex-1">{e.estimate_title || e.print_type || ""}</span>
                  {e.is_final_submitted && <Badge className="text-[9px] bg-amber-100 text-amber-700 hover:bg-amber-100">最終提出版</Badge>}
                  {e.total_amount > 0 && <span className="tabular-nums text-muted-foreground">{yen(e.total_amount)}</span>}
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {g.items.map((li) => {
                      const k = key(e, li);
                      const src = sourceOf(li);
                      return (
                        <tr key={k} className={`border-t cursor-pointer ${picked.has(k) ? "bg-primary/5" : "hover:bg-muted/30"}`} onClick={() => toggle(k)}>
                          <td className="px-3 py-1.5 w-6" onClick={(ev) => ev.stopPropagation()}>
                            <Checkbox checked={picked.has(k)} onCheckedChange={() => toggle(k)} />
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="truncate max-w-[280px]">{li.name}</div>
                            <div className="text-[10px] text-muted-foreground">{li.category}</div>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{Number(li.quantity || 1).toLocaleString()}{li.unit || ""}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap text-amber-700">
                            {li.cost_price != null ? `原価 ${yenCost(li.cost_price)}` : ""}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">@{yen(li.unit_price)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap font-medium">{yen(li.amount)}</td>
                          <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
                            {src.url ? (
                              <a href={src.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-foreground" onClick={(ev) => ev.stopPropagation()}>
                                {src.label} <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : src.label}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{picked.size}件選択中</span>
        <Button onClick={submit} disabled={picked.size === 0} className="gap-1.5">
          <Copy className="w-4 h-4" /> 選択した明細を複製
        </Button>
      </div>
    </div>
  );
}
