// 銀行明細 CSV の取り込み（入金確認と資金繰り表で共通）
import { db } from "@/api/db";
import { decodeCsv, parseBankCsv, BANK_LABELS } from "@/lib/bankImport";

/** CSV ファイルを読み、未登録の明細だけ保存する。返り値 { bank, label, fresh, total } */
export async function importBankCsvFile(file, userId) {
  const text = await decodeCsv(file);
  const { bank, rows } = await parseBankCsv(text);
  const existing = await db.entities.BankTransaction.whereIn("source_hash", rows.map((r) => r.source_hash));
  const known = new Set(existing.map((r) => r.source_hash));
  const fresh = rows.filter((r) => !known.has(r.source_hash)).map((r) => ({ ...r, imported_by: userId || null }));
  if (fresh.length > 0) await db.entities.BankTransaction.createMany(fresh);
  return { bank, label: BANK_LABELS[bank] || bank, fresh: fresh.length, total: rows.length };
}
