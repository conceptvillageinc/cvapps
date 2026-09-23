import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { pricingRulesFromSettings } from "@/lib/pricing";

// 数値入力。空・不正なら保存時に既定値を使う
function NumInput({ value, onChange, step = "0.01", suffix, className = "" }) {
  return (
    <div className="flex items-center gap-1.5">
      <Input type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)} className={`h-9 ${className}`} />
      {suffix && <span className="text-xs text-muted-foreground shrink-0">{suffix}</span>}
    </div>
  );
}

// 0.07 ↔ "7" のように、%で編集する
const toPct = (rate) => String(Math.round(Number(rate) * 1000) / 10);
const fromPct = (pct) => Number(pct) / 100;

/**
 * 値付けルール（「デザイン制作原価売価計算表」の%と単価）の編集。
 * 変更は system_settings の pricing_rules に自動保存される。
 */
export default function PricingRulesCard({ settings, upsertSetting }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(null);
  const skipAutosave = useRef(true);

  // 読み込み（settings が変わっても、編集中の内容を上書きしないよう最初の1回だけ）
  useEffect(() => {
    if (settings.length === 0 || form) return;
    const r = pricingRulesFromSettings(settings);
    setForm({
      markup_package: String(r.markup.package),
      markup_other: String(r.markup.other),
      out_design: String(r.outsourcing.design),
      out_build: String(r.outsourcing.build),
      out_photo: String(r.outsourcing.photo),
      round_out: String(r.rounding.outsourcing),
      round_concept: String(r.rounding.concept),
      round_proof: String(r.rounding.proofreading),
      concept_rate: toPct(r.concept_fee.rate),
      direction_rate: toPct(r.direction_fee.rate),
      round_direction: String(r.rounding.direction ?? r.rounding.concept),
      proof_rate: toPct(r.proofreading_fee.rate),
      discounts: r.discounts.map((d) => ({ key: d.key, label: d.label, rate: toPct(d.rate) })),
      hourly: Object.fromEntries(Object.entries(r.hourly).map(([k, v]) => [k, String(v)])),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.length]);

  // 自動保存
  useEffect(() => {
    if (!form) return;
    if (skipAutosave.current) { skipAutosave.current = false; return; }
    const t = setTimeout(() => {
      const n = (v, fallback) => (Number(v) > 0 ? Number(v) : fallback);
      const payload = {
        markup: { package: n(form.markup_package, 1.3), other: n(form.markup_other, 1.35) },
        outsourcing: { design: n(form.out_design, 0.6), build: n(form.out_build, 0.75), photo: n(form.out_photo, 0.6) },
        rounding: { outsourcing: n(form.round_out, 5000), concept: n(form.round_concept, 5000), proofreading: n(form.round_proof, 1000), direction: n(form.round_direction, 5000) },
        concept_fee: { rate: fromPct(n(form.concept_rate, 20)) },
        direction_fee: { rate: fromPct(n(form.direction_rate, 10)) },
        proofreading_fee: { rate: fromPct(n(form.proof_rate, 7)) },
        discounts: form.discounts
          .filter((d) => d.label.trim() && Number(d.rate) > 0)
          .map((d, i) => ({ key: d.key || `d${i}`, label: d.label.trim(), rate: fromPct(d.rate) })),
        hourly: Object.fromEntries(Object.entries(form.hourly).map(([k, v]) => [k, n(v, 0)])),
      };
      upsertSetting(settings, "pricing_rules", JSON.stringify(payload), "値付けルール（原価売価計算表）")
        .then(() => queryClient.invalidateQueries({ queryKey: ["settings"] }))
        .catch((err) => toast.error("自動保存に失敗しました: " + err.message));
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  if (!form) return null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setDiscount = (i, patch) => setForm((f) => ({ ...f, discounts: f.discounts.map((d, j) => (j === i ? { ...d, ...patch } : d)) }));
  const setHourly = (k, v) => setForm((f) => ({ ...f, hourly: { ...f.hourly, [k]: v } }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">値付けルール</CardTitle>
        <CardDescription className="text-xs">
          「デザイン制作原価売価計算表」の計算式を見積書タブで使います。%や単位を変えると、以降に追加する明細から反映されます
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-2">
          <p className="text-xs font-semibold">印刷費の掛け率（出し値 = 原価 × 掛け率）</p>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <div className="space-y-1.5">
              <Label className="text-xs">パッケージ</Label>
              <NumInput value={form.markup_package} onChange={(v) => set("markup_package", v)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">パッケージ以外の制作物</Label>
              <NumInput value={form.markup_other} onChange={(v) => set("markup_other", v)} />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">印刷物種別・価格マスタのカテゴリ名に「パッケージ」を含むものがパッケージ扱いです</p>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-semibold">外注（売価 = 仕入 ÷ 率）</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl">
            <div className="space-y-1.5">
              <Label className="text-xs">外注デザイン</Label>
              <NumInput value={form.out_design} onChange={(v) => set("out_design", v)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">構築</Label>
              <NumInput value={form.out_build} onChange={(v) => set("out_build", v)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">外注撮影</Label>
              <NumInput value={form.out_photo} onChange={(v) => set("out_photo", v)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">切り上げ単位</Label>
              <NumInput value={form.round_out} onChange={(v) => set("round_out", v)} step="1000" suffix="円" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">例: 仕入 35,000円 ÷ 0.6 = 58,334円 → 5,000円単位で切り上げて 60,000円</p>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-semibold">自動計算行（ここは追加時の初期値。見積ごとに%を変えることもできます）</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl">
            <div className="space-y-1.5">
              <Label className="text-xs">コンセプト設計費</Label>
              <NumInput value={form.concept_rate} onChange={(v) => set("concept_rate", v)} step="0.1" suffix="%" />
              <p className="text-[10px] text-muted-foreground">印刷費を除く合計に対して</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">切り上げ単位</Label>
              <NumInput value={form.round_concept} onChange={(v) => set("round_concept", v)} step="1000" suffix="円" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">ディレクション費</Label>
              <NumInput value={form.direction_rate} onChange={(v) => set("direction_rate", v)} step="0.1" suffix="%" />
              <p className="text-[10px] text-muted-foreground">印刷費を除く合計に対して</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">切り上げ単位</Label>
              <NumInput value={form.round_direction} onChange={(v) => set("round_direction", v)} step="1000" suffix="円" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">校正費</Label>
              <NumInput value={form.proof_rate} onChange={(v) => set("proof_rate", v)} step="0.1" suffix="%" />
              <p className="text-[10px] text-muted-foreground">デザイン費の合計に対して</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">切り上げ単位</Label>
              <NumInput value={form.round_proof} onChange={(v) => set("round_proof", v)} step="1000" suffix="円" />
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-semibold">割引（デザイン費の合計に対する%を値引き）</p>
          <div className="space-y-2 max-w-xl">
            {form.discounts.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={d.label} onChange={(e) => setDiscount(i, { label: e.target.value })} placeholder="表示名（例: CV割引（10%））" className="h-9 flex-1" />
                <NumInput value={d.rate} onChange={(v) => setDiscount(i, { rate: v })} step="0.1" suffix="%" className="w-24" />
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setForm((f) => ({ ...f, discounts: f.discounts.filter((_, j) => j !== i) }))}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setForm((f) => ({ ...f, discounts: [...f.discounts, { key: `d${Date.now()}`, label: "", rate: "" }] }))}>
              <Plus className="w-3.5 h-3.5" /> 割引を追加
            </Button>
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-semibold">社内の時間単価（税抜・参考値）</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-2xl">
            {[
              ["produce", "プロデュース・企画・コンサル（時間）"],
              ["model", "モデル対応（時間／式）"],
              ["other_work", "撮影同行サポート等（時間／式）"],
              ["inhouse_design", "社内デザイン（時間／式）"],
              ["inhouse_photo", "社内撮影（時間／式）"],
              ["labeling", "一括表示作成費（商品）"],
            ].map(([k, label]) => (
              <div key={k} className="space-y-1.5">
                <Label className="text-xs">{label}</Label>
                <NumInput value={form.hourly[k] ?? ""} onChange={(v) => setHourly(k, v)} step="1000" suffix="円" />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">見積書タブの「自由入力」で単価の目安として表示します</p>
        </section>
      </CardContent>
    </Card>
  );
}
