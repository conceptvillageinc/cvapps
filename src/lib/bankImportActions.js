// 銀行明細の取り込み（入金確認と資金繰り表で共通）
//
// 取り込んだ場所を scope に残す:
//   payments … 入金確認で取り込んだもの。入金確認・会計データ出力・売上粗利管理表・資金繰り表の全部で使う
//   cashplan … 資金繰り表で取り込んだもの。資金繰り表の残高の起点にだけ使い、ほかの画面には出さない
// 同じ明細（source_hash が同じ）は 1 行しか持たない。資金繰り表で先に入れた行を入金確認で取り込み直すと
// payments に昇格し、入金確認にも並ぶようになる。逆（入金確認の行を資金繰り表で取り込み直す）は何もしない。
import { db } from "@/api/db";
import { decodeCsv, parseBankCsv, BANK_LABELS } from "@/lib/bankImport";

export const BANK_TX_SCOPES = ["payments", "cashplan"];

/** 入金確認など、資金繰り表以外の画面で使う明細だけにする */
export const forPayments = (txs) => (txs || []).filter((t) => t.scope !== "cashplan");

/**
 * 正規化済みの明細行を保存する。
 * @returns {{ fresh:number, promoted:number, known:number, total:number }}
 *   fresh=新しく入れた行、promoted=資金繰り表の行を入金確認に昇格した行、known=すでにあった行
 */
export async function saveBankRows(rows, { userId, scope = "payments" } = {}) {
  if (!BANK_TX_SCOPES.includes(scope)) throw new Error(`scope が不正です: ${scope}`);
  const existing = rows.length > 0 ? await db.entities.BankTransaction.whereIn("source_hash", rows.map((r) => r.source_hash)) : [];
  const byHash = new Map(existing.map((r) => [r.source_hash, r]));
  const fresh = rows.filter((r) => !byHash.has(r.source_hash)).map((r) => ({ ...r, imported_by: userId || null, scope }));
  if (fresh.length > 0) await db.entities.BankTransaction.createMany(fresh);
  let promoted = 0;
  if (scope === "payments") {
    const toPromote = existing.filter((r) => r.scope === "cashplan");
    for (const r of toPromote) await db.entities.BankTransaction.update(r.id, { scope: "payments" });
    promoted = toPromote.length;
  }
  return { fresh: fresh.length, promoted, known: rows.length - fresh.length - promoted, total: rows.length };
}

/** CSV ファイルを読み、未登録の明細だけ保存する。返り値 { bank, label, fresh, promoted, known, total } */
export async function importBankCsvFile(file, { userId, scope = "payments" } = {}) {
  const text = await decodeCsv(file);
  const { bank, rows } = await parseBankCsv(text);
  const r = await saveBankRows(rows, { userId, scope });
  return { bank, label: BANK_LABELS[bank] || bank, ...r };
}

/** 取り込み結果の文言 */
export function importResultText(label, r) {
  const parts = [`新規 ${r.fresh}件`];
  if (r.promoted > 0) parts.push(`資金繰り表から ${r.promoted}件を引き継ぎ`);
  parts.push(`取込済み ${r.known}件`);
  return `${label}の明細を取り込みました（${parts.join("・")}）`;
}
