// ============================================================================
// メールの「名乗り」と「署名」（ユーザーごと）
//
// 名乗り: 「コンセプト・ヴィレッジ　馬場です。」（会社名の「株式会社」を外し、苗字だけ）
// 署名:   ユーザーが「自分の設定」で登録したもの。未設定なら会社名・氏名・メール・電話から組み立てる
// ============================================================================
import { COMPANY_INFO } from "@/lib/constants";

/** 会社名から「株式会社」「有限会社」などを外した呼び名 */
export function companyShortName(name = COMPANY_INFO.name) {
  return String(name || "").replace(/^(株式会社|有限会社|合同会社|一般社団法人)\s*/, "").replace(/\s*(株式会社|有限会社|合同会社)$/, "").trim();
}

/** 名乗りに使う名前（苗字）。未設定なら氏名の最初の語（「馬場 大治」→「馬場」） */
export function senderShortName(user) {
  if (!user) return "";
  if (user.short_name && user.short_name.trim()) return user.short_name.trim();
  const full = String(user.full_name || "").trim();
  if (!full || full.includes("@")) return "";
  return full.split(/[\s　]+/)[0];
}

/** 「コンセプト・ヴィレッジ　馬場です。」 */
export function greetingLine(user, company) {
  const co = companyShortName(company?.name || COMPANY_INFO.name);
  const who = senderShortName(user);
  return who ? `${co}　${who}です。` : `${co}です。`;
}

/** 署名（登録済みならそれをそのまま。未設定なら既定の署名） */
export function senderSignature(user, company) {
  if (user?.email_signature && user.email_signature.trim()) return user.email_signature.trim();
  return defaultSignature(user, company);
}

/** 既定の署名: 会社名／氏名／メール／電話 */
export function defaultSignature(user, company) {
  const co = company || COMPANY_INFO;
  const name = user?.full_name && !String(user.full_name).includes("@") ? user.full_name : "";
  return [co.name || COMPANY_INFO.name, name, user?.email || "", co.tel ? `tel ${co.tel}` : ""].filter(Boolean).join("\n");
}
