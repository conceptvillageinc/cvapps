// ============================================================================
// 差出人を決めて送るメール（画面とサーバー（api/send-document-email.js）の両方で使うので、@/ の読み込みは使わない）
//   請求書: 会社の共通アドレスから送り、送付確認用に同じアドレスを CC にも入れる
//   それ以外（見積書・納品書・領収書・発注書）: これまでどおり、ログイン中の本人から送る
//   ※ このアドレスは Google Workspace のユーザー（メールボックス）であること（グループ・別名だと送れない）
// ============================================================================

export const INVOICE_MAIL_SENDER = "info@concept-village.co.jp";

/** 書類の種類ごとの差出人（null なら本人）と、いつも CC に入れるアドレス */
export function documentMailSender(type) {
  if (type === "invoice") return { sendAs: INVOICE_MAIL_SENDER, cc: [INVOICE_MAIL_SENDER] };
  return { sendAs: null, cc: [] };
}
