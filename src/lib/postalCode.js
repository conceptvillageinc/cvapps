// 郵便番号ユーティリティ
// 保存形式はハイフンなし7桁の数字（例: 9630117）に統一し、
// 表示する場面ごとに「〒963-0117」の形式へ変換する。

// 入力値から数字以外を取り除く（ハイフン付きで入力されても自動で正規化できるように）
export function normalizePostalCode(input) {
  return String(input || "").replace(/[^0-9]/g, "");
}

// 7桁の数字かどうかを判定
export function isValidPostalCode(value) {
  const digits = normalizePostalCode(value);
  return digits.length === 7;
}

// 表示用：〒000-0000 の形式に変換。7桁でない場合はそのまま返す
export function formatPostalCode(value) {
  const digits = normalizePostalCode(value);
  if (digits.length !== 7) return value || "";
  return `〒${digits.slice(0, 3)}-${digits.slice(3)}`;
}

// 入力中表示用：半角スペースで区切って視認性を上げる（保存値自体はハイフンなしのまま）
export function formatPostalInput(value) {
  const digits = normalizePostalCode(value).slice(0, 7);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}
