// 印刷物種別（印刷費の大カテゴリ）のマスタ。
// システム設定 print_types に [{ name, paper_group }] の JSON で保存する。
// 無ければアプリ内の固定一覧（constants.js の PRINT_TYPES）を使う。
import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { PRINT_TYPES, NONPAPER_PRINT_TYPES } from "@/lib/constants";
import { useSystemSettings } from "@/lib/useSystemSettings";

export const PRINT_TYPES_KEY = "print_types";
export const PAPER_GROUPS = ["紙", "紙以外"];

export const defaultPrintTypes = () => PRINT_TYPES.map((name) => ({ name, paper_group: NONPAPER_PRINT_TYPES.includes(name) ? "紙以外" : "紙" }));

/** 保存されている値（文字列の配列でも、{name, paper_group} の配列でも）を同じ形にそろえる */
export function normalizePrintTypes(raw) {
  let list = raw;
  if (typeof raw === "string") { try { list = JSON.parse(raw); } catch { list = null; } }
  if (!Array.isArray(list) || list.length === 0) return defaultPrintTypes();
  const out = [];
  for (const it of list) {
    const name = String(typeof it === "string" ? it : it?.name || "").trim();
    if (!name || out.some((x) => x.name === name)) continue;
    const group = typeof it === "object" && PAPER_GROUPS.includes(it?.paper_group) ? it.paper_group : (NONPAPER_PRINT_TYPES.includes(name) ? "紙以外" : "紙");
    out.push({ name, paper_group: group });
  }
  return out.length ? out : defaultPrintTypes();
}

export function usePrintTypes() {
  const { settings, isLoading } = useSystemSettings();
  const row = settings.find((x) => x.setting_key === PRINT_TYPES_KEY) || null;
  const types = useMemo(() => normalizePrintTypes(row?.setting_value), [row?.setting_value]);
  const names = useMemo(() => types.map((t) => t.name), [types]);
  const groupOf = (name) => types.find((t) => t.name === name)?.paper_group || (NONPAPER_PRINT_TYPES.includes(name) ? "紙以外" : "紙");
  return { types, names, groupOf, row, isLoading, fromSettings: !!row };
}

/** マスタを保存する（システム設定に upsert） */
export function useSavePrintTypes() {
  const queryClient = useQueryClient();
  return async (row, types) => {
    const data = { setting_key: PRINT_TYPES_KEY, setting_value: JSON.stringify(types.map((t) => ({ name: t.name, paper_group: t.paper_group }))), description: "印刷物種別（印刷費の大カテゴリ）の一覧と表示順" };
    if (row) await db.entities.SystemSettings.update(row.id, data);
    else await db.entities.SystemSettings.create(data);
    await queryClient.invalidateQueries({ queryKey: ["settings"] });
  };
}
