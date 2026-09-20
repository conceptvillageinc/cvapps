import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { FileSpreadsheet, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { accountingSettingsFrom, buildJournal, toCsv, downloadText, MF_COLUMNS } from "@/lib/mfExport";
import { todayString } from "@/lib/fiscal";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;

async function upsertSetting(settings, key, value, description) {
  const existing = settings.find((s) => s.setting_key === key);
  if (existing) return db.entities.SystemSettings.update(existing.id, { setting_value: value });
  return db.entities.SystemSettings.create({ setting_key: key, setting_value: value, description });
}

function monthRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

/** MF会計向けの仕訳CSV出力 */
export default function AccountingExport() {
  const queryClient = useQueryClient();
  const { settings } = useSystemSettings();
  const acct = useMemo(() => accountingSettingsFrom(settings), [settings]);
  const [month, setMonth] = useState(todayString().slice(0, 7));
  const [includeSales, setIncludeSales] = useState(true);
  const [includePayments, setIncludePayments] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["invoices", "all"],
    queryFn: () => db.entities.Invoice.list("-invoice_date"),
  });
  const { data: txs = [] } = useQuery({
    queryKey: ["bankTransactions", "matched"],
    queryFn: () => db.entities.BankTransaction.filter({ match_status: "matched" }),
  });

  const { from, to } = monthRange(month);
  const rows = useMemo(
    () => buildJournal(invoices, txs, { includeSales, includePayments, from, to, settings: acct }),
    [invoices, txs, includeSales, includePayments, from, to, acct],
  );
  const drTotal = rows.reduce((s, r) => s + Number(r["借方金額(円)"] || 0), 0);

  const download = () => {
    if (rows.length === 0) { toast.info("この月の仕訳はありません"); return; }
    downloadText(toCsv(rows), `MF仕訳_${month}.csv`);
  };

  const saveAccounts = async () => {
    setSaving(true);
    try {
      await upsertSetting(settings, "accounting_settings", JSON.stringify(draft), "MF会計 仕訳CSVの勘定科目");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setEditing(false);
      toast.success("勘定科目の設定を保存しました");
    } catch (err) {
      toast.error("保存できませんでした: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><FileSpreadsheet className="w-5 h-5" /> 会計データ出力（MF仕訳）</h1>
          <p className="text-sm text-muted-foreground mt-0.5">請求書の売上計上と入金を、MF会計の仕訳インポート形式のCSVにします</p>
        </div>
        <Button className="gap-2" onClick={download} disabled={rows.length === 0}><Download className="w-4 h-4" /> CSVをダウンロード（{rows.length}行）</Button>
      </div>

      <Card>
        <CardContent className="pt-5 flex flex-col sm:flex-row sm:items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">対象月</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-44" />
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer h-9"><Checkbox checked={includeSales} onCheckedChange={(v) => setIncludeSales(!!v)} /> 売上計上（請求日ベース: 売掛金 / 売上高）</label>
          <label className="flex items-center gap-2 text-xs cursor-pointer h-9"><Checkbox checked={includePayments} onCheckedChange={(v) => setIncludePayments(!!v)} /> 入金（入金日ベース: 普通預金 / 売掛金）</label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">プレビュー（{rows.length}行・借方合計 {yen(drTotal)}）</CardTitle>
          <CardDescription className="text-xs">MF会計 → 会計帳簿 → 仕訳帳 → インポート → 「マネーフォワード クラウド会計」形式で取り込めます（UTF-8・BOM付き）</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : rows.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-10">この月の仕訳はありません（請求日または入金日が対象月の請求書が対象です）</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    {["取引日", "借方勘定科目", "借方補助科目", "借方金額(円)", "貸方勘定科目", "貸方税区分", "貸方金額(円)", "貸方税額", "取引先", "摘要"].map((h) => (
                      <th key={h} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1 whitespace-nowrap">{r["取引日"]}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{r["借方勘定科目"]}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{r["借方補助科目"]}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{Number(r["借方金額(円)"]).toLocaleString()}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{r["貸方勘定科目"]}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{r["貸方税区分"]}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{Number(r["貸方金額(円)"]).toLocaleString()}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{Number(r["貸方税額"]).toLocaleString()}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{r["貸方取引先"]}</td>
                      <td className="px-2 py-1 truncate max-w-[300px]">{r["摘要"]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">勘定科目・税区分の表記</CardTitle>
              <CardDescription className="text-xs">会計事務所の MF の設定に合わせて変更できます。列は {MF_COLUMNS.length} 列（MFの仕訳帳エクスポート形式）</CardDescription>
            </div>
            {!editing ? (
              <Button variant="outline" size="sm" className="text-xs" onClick={() => { setDraft({ ...acct, bank_sub_accounts: { ...acct.bank_sub_accounts } }); setEditing(true); }}>編集</Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => setEditing(false)}>キャンセル</Button>
                <Button size="sm" className="text-xs" onClick={saveAccounts} disabled={saving}>{saving ? "保存中..." : "保存"}</Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {(() => {
            const v = editing ? draft : acct;
            const set = (k, val) => setDraft((d) => ({ ...d, [k]: val }));
            const fields = [
              ["sales_account", "売上の勘定科目"], ["receivable_account", "売掛金の勘定科目"], ["deposit_account", "預金の勘定科目"],
              ["fee_account", "振込手数料の勘定科目"], ["tax_category_sales", "税区分（10%）"], ["tax_category_sales_reduced", "税区分（軽減8%）"],
              ["tax_category_none", "税区分（対象外）"], ["department", "部門（任意）"],
            ];
            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {fields.map(([k, label]) => (
                  <div key={k} className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">{label}</Label>
                    {editing ? <Input value={v[k] || ""} onChange={(e) => set(k, e.target.value)} className="h-8 text-xs" /> : <p className="text-xs h-8 flex items-center">{v[k] || "—"}</p>}
                  </div>
                ))}
                {["toho", "ryukyu"].map((b) => (
                  <div key={b} className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">預金の補助科目（{b === "toho" ? "東邦" : "琉球"}）</Label>
                    {editing
                      ? <Input value={v.bank_sub_accounts?.[b] || ""} onChange={(e) => setDraft((d) => ({ ...d, bank_sub_accounts: { ...d.bank_sub_accounts, [b]: e.target.value } }))} className="h-8 text-xs" />
                      : <p className="text-xs h-8 flex items-center">{v.bank_sub_accounts?.[b] || "—"}</p>}
                  </div>
                ))}
              </div>
            );
          })()}
        </CardContent>
      </Card>
    </div>
  );
}
