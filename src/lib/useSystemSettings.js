// system_settings の選択肢をまとめて読むフック。
// 受注確度・フェーズ・期首月は複数の画面で使うため、ここに集約する。

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/api/db";
import { DEFAULT_FISCAL_YEAR_START_MONTH } from "@/lib/constants";

const DEFAULT_DEAL_PROBABILITY = ["A", "C", "A（定期売上）", "要注意（A）"];
const DEFAULT_PHASE = ["未着手", "着手中", "受注済"];

function parseList(settings, key, fallback) {
  const s = settings.find((x) => x.setting_key === key);
  if (!s) return fallback;
  try {
    const v = JSON.parse(s.setting_value);
    return Array.isArray(v) && v.length > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

export function useSystemSettings() {
  const { data: settings = [], isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => db.entities.SystemSettings.list(),
  });

  return useMemo(() => {
    const fy = settings.find((x) => x.setting_key === "fiscal_year_start_month");
    const fiscalYearStartMonth = fy && Number(fy.setting_value) >= 1 && Number(fy.setting_value) <= 12
      ? Number(fy.setting_value)
      : DEFAULT_FISCAL_YEAR_START_MONTH;
    const gm = settings.find((x) => x.setting_key === "gross_margin_target");
    const grossMarginTarget = gm && Number(gm.setting_value) > 0 && Number(gm.setting_value) <= 1 ? Number(gm.setting_value) : 0.8;
    // 資金繰り表を見られる人（メールアドレスの一覧）。未設定なら馬場さんだけ
    const ce = settings.find((x) => x.setting_key === "cashflow_allowed_emails");
    let cashflowAllowedEmails = ["daichi@concept-village.co.jp"];
    if (ce) { try { const v = JSON.parse(ce.setting_value); if (Array.isArray(v) && v.length) cashflowAllowedEmails = v.map((e) => String(e).trim().toLowerCase()).filter(Boolean); } catch { /* 既定のまま */ } }
    const sl = settings.find((x) => x.setting_key === "cashflow_safety_line");
    const cashSafetyLine = sl && sl.setting_value !== "" && Number.isFinite(Number(sl.setting_value)) ? Number(sl.setting_value) : null;
    const cd = settings.find((x) => x.setting_key === "cashflow_card_pay_day");
    const cardPayDay = cd && Number(cd.setting_value) >= 1 && Number(cd.setting_value) <= 31 ? Number(cd.setting_value) : 27;
    const pm = settings.find((x) => x.setting_key === "payables_cost_month");
    const payablesMonthMode = pm && pm.setting_value === "same" ? "same" : "prev";
    return {
      settings,
      isLoading,
      grossMarginTarget,
      payablesMonthMode,
      cashflowAllowedEmails,
      cashSafetyLine,
      cardPayDay,
      dealProbabilityOptions: parseList(settings, "deal_probability_options", DEFAULT_DEAL_PROBABILITY),
      phaseOptions: parseList(settings, "phase_options", DEFAULT_PHASE),
      fiscalYearStartMonth,
    };
  }, [settings, isLoading]);
}
