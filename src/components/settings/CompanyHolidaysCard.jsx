import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CalendarOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { expandCompanyHolidays } from "@/lib/jpHolidays";

/**
 * 会社の休業日（夏季休暇など）。速報デイリーの残り営業日・週と月の目標の計算から除く。
 *   土日・祝日・年末年始（12/29〜1/3）は自動で除くので、ここにはそれ以外の休みだけを入れる。
 */
export default function CompanyHolidaysCard({ settings, upsertSetting }) {
  const queryClient = useQueryClient();
  const { companyHolidayLines } = useSystemSettings();
  const [text, setText] = useState(companyHolidayLines.join("\n"));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setText(companyHolidayLines.join("\n")); }, [companyHolidayLines.join("\n")]); // eslint-disable-line react-hooks/exhaustive-deps

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const bad = lines.filter((l) => expandCompanyHolidays([l]).size === 0);
  const days = expandCompanyHolidays(lines).size;
  const save = async () => {
    if (bad.length) { toast.error(`日付として読めない行があります: ${bad[0]}`); return; }
    setSaving(true);
    try {
      await upsertSetting(settings, "company_holidays", JSON.stringify(lines), "会社の休業日（営業日の計算から除く）");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("会社の休業日を保存しました");
    } catch (e) {
      toast.error("保存できませんでした: " + e.message);
    } finally { setSaving(false); }
  };
  return (
    <Card data-testid="company-holidays">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><CalendarOff className="w-4 h-4" /> 会社の休業日</CardTitle>
        <CardDescription className="text-xs">夏季休暇など、会社独自の休みを入れます。速報デイリーの「残り営業日」と週・月の目標の計算から除きます（土日・祝日・年末年始 12/29〜1/3 は自動で除くので入れなくて大丈夫です）</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} className="text-sm font-mono" placeholder={"1 行に 1 つ。期間は〜でつなぎ、後ろにメモを書けます\n2027-08-12〜2027-08-16 夏季休暇\n2027-05-06 創立記念日"} aria-label="会社の休業日" />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">{lines.length ? `${lines.length} 件・${days} 日` : "未登録"}</span>
          {bad.length > 0 && <span className="text-destructive">日付として読めない行: {bad.join("、")}</span>}
          <Button type="button" size="sm" className="ml-auto h-8 text-xs gap-1" onClick={save} disabled={saving}>{saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} 保存</Button>
        </div>
      </CardContent>
    </Card>
  );
}
