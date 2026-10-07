// ============================================================================
// 一覧の列の並び・表示（見積書・納品書・請求書・領収書・発注書）
//   全員共通。システム設定 list_columns に { 一覧: [{ key, visible }] } の JSON で保存する。
//   設定に無い列（後から足した列）は最後に表示で足す。
// ============================================================================
import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { useSystemSettings } from "@/lib/useSystemSettings";

export const LIST_COLUMNS_KEY = "list_columns";

/** 一覧ごとの列（初期の並び） */
export const LIST_DEFS = {
  estimates: {
    label: "見積書", columns: [
      ["estimate_number", "見積番号"], ["submission", "提出"], ["client_name", "クライアント"], ["print_type", "印刷物種別"],
      ["deal_probability", "受注確度"], ["phase", "フェーズ"], ["total_amount", "合計金額"], ["desired_delivery_date", "希望納期"],
      ["created_date", "作成日"], ["person_in_charge", "作成担当者"],
    ],
  },
  delivery_notes: {
    label: "納品書", columns: [
      ["delivery_number", "番号"], ["delivery_date", "納品日"], ["client_name", "クライアント"], ["title", "件名"],
      ["total", "合計（税込）"], ["status", "状態"], ["invoice", "請求"],
    ],
  },
  invoices: {
    label: "請求書", columns: [
      ["invoice_number", "番号"], ["invoice_date", "請求日"], ["due_date", "入金期日"], ["client_name", "請求先"],
      ["title", "件名"], ["total", "請求金額"], ["status", "状態"],
    ],
  },
  receipts: {
    label: "領収書", columns: [
      ["receipt_number", "番号"], ["issue_date", "発行日"], ["client_name", "宛名"], ["proviso", "但し書き"],
      ["total", "金額（税込）"], ["payment_method", "受領"], ["status", "状態"],
    ],
  },
  partner_orders: {
    label: "発注書", columns: [
      ["po_number", "番号"], ["order_date", "発注日"], ["partner_name", "連携先"], ["title", "件名"],
      ["due_date", "納期"], ["total", "発注金額（税込）"], ["status", "状態"],
    ],
  },
};
export const LIST_KEYS = Object.keys(LIST_DEFS);

const defaultColumns = (list) => LIST_DEFS[list].columns.map(([key]) => ({ key, visible: true }));

/** 保存されている並びに、定義の列をそろえる（消えた列は外し、新しい列は最後に表示で足す） */
export function normalizeListColumns(list, saved) {
  const known = new Set(LIST_DEFS[list].columns.map(([k]) => k));
  const out = [];
  for (const c of Array.isArray(saved) ? saved : []) {
    if (c && known.has(c.key) && !out.some((x) => x.key === c.key)) out.push({ key: c.key, visible: c.visible !== false });
  }
  for (const [key] of LIST_DEFS[list].columns) if (!out.some((x) => x.key === key)) out.push({ key, visible: true });
  // 全部隠すと一覧が空になるので、そのときは先頭の列を出す
  if (!out.some((c) => c.visible)) out[0].visible = true;
  return out;
}

export function parseAllListColumns(raw) {
  let v = {};
  try { v = typeof raw === "string" ? JSON.parse(raw) || {} : raw || {}; } catch { v = {}; }
  return Object.fromEntries(LIST_KEYS.map((k) => [k, normalizeListColumns(k, v[k])]));
}

export const columnLabel = (list, key) => LIST_DEFS[list].columns.find(([k]) => k === key)?.[1] || key;

/** 設定全体（hook） */
export function useAllListColumns() {
  const { settings, isLoading } = useSystemSettings();
  const row = settings.find((x) => x.setting_key === LIST_COLUMNS_KEY) || null;
  const all = useMemo(() => parseAllListColumns(row?.setting_value), [row?.setting_value]);
  return { all, row, isLoading };
}

/** 一覧で表示する列の key（並び順・表示する列だけ） */
export function useListColumns(list) {
  const { all } = useAllListColumns();
  return useMemo(() => all[list].filter((c) => c.visible).map((c) => c.key), [all, list]);
}

/** 1 つの一覧の並びを保存する（全員共通） */
export function useSaveListColumns() {
  const queryClient = useQueryClient();
  return async (row, all, list, columns) => {
    const next = { ...Object.fromEntries(LIST_KEYS.map((k) => [k, all[k]])), [list]: normalizeListColumns(list, columns) };
    const data = { setting_key: LIST_COLUMNS_KEY, setting_value: JSON.stringify(next), description: "一覧（見積書・納品書・請求書・領収書・発注書）の列の並びと表示" };
    if (row) await db.entities.SystemSettings.update(row.id, data);
    else await db.entities.SystemSettings.create(data);
    await queryClient.invalidateQueries({ queryKey: ["settings"] });
  };
}
