// ============================================================================
// 校了フォーム（クライアントがログインなしで最終デザインを確認・回答する）
//   画面（ブラウザ）とサーバー（api/proof-form.js）の両方で使うので、@/ の読み込みは使わない
//
//   質問の形: { id, type: "text" | "paragraph" | "checkbox" | "radio", label, required, options, help }
//   答えの形: { [質問の id]: 文字（text・paragraph・radio）| 文字の配列（checkbox） }
// ============================================================================

export const PROOF_TITLE = "商品ラベル 校了確認フォーム";

export const PROOF_DESCRIPTION = [
  "最終デザインをご確認のうえ、下記項目へのご回答をお願いいたします。",
  "ご回答をもって、印刷・製造へ進行するための最終確認とさせていただきます。",
  "校了後の修正並びにデザイン変更は別途御見積となります。",
].join("\n");

export const APPROVE_OPTION = "上記内容を確認し、このデータで校了します。";
export const REVISE_OPTION = "修正を希望します。";

/** 質問のひな形（新しいフォームはこの形で作る） */
export const PROOF_QUESTIONS = [
  { id: "company", type: "text", label: "会社名・店舗名", required: true },
  { id: "person", type: "text", label: "ご担当者名", required: false },
  { id: "design", type: "checkbox", label: "デザイン・記載内容について", required: true, options: ["修正あり", "商品名・文章・内容量・デザイン等に誤りがないことを確認しました。"] },
  { id: "food", type: "checkbox", label: "食品表示について", required: true, options: ["修正あり", "原材料名・栄養成分表示・保存方法・製造者情報・賞味期限表示等に誤りがないことを確認しました。"] },
  { id: "jan", type: "checkbox", label: "JANコード・バーコードについて", required: true, options: ["修正あり", "JANコードおよびバーコードの内容に誤りがないことを確認しました。"] },
  { id: "final", type: "radio", label: "最終確認", required: true, options: [APPROVE_OPTION, REVISE_OPTION] },
  { id: "note", type: "paragraph", label: "修正内容・ご連絡事項", required: false, help: "修正をご希望の場合は、該当箇所と修正内容をご記入ください。" },
];

/** 校了フォームの問い合わせ先の電話番号 */
export const PROOF_TEL = "070-2011-0831";

/** 送信後のメッセージ */
export const proofConfirmMessage = (tel = PROOF_TEL) => [
  "ご確認ありがとうございました。",
  "「校了します」をご選択いただいた場合は、こちらの内容をもって印刷・製造へ進行いたします。",
  `修正がございましたら大変お手数ではございますが、TEL:${tel}までお電話をいただけますと幸いです。`,
].join("\n");

export const QUESTION_TYPE_LABEL = { text: "記述式", paragraph: "段落", checkbox: "チェックボックス", radio: "ラジオボタン" };

const MAX_TEXT = 2000;

/**
 * 答えを確かめる。{ ok, errors: { [id]: メッセージ }, clean: 整えた答え }
 *   必須の未回答、選択肢に無い値、長すぎる文を弾く
 */
export function validateAnswers(questions, answers) {
  const errors = {};
  const clean = {};
  for (const q of questions || []) {
    const v = answers?.[q.id];
    if (q.type === "checkbox") {
      const list = (Array.isArray(v) ? v : []).filter((x) => (q.options || []).includes(x));
      if (q.required && list.length === 0) errors[q.id] = "どれかにチェックを入れてください";
      clean[q.id] = list;
    } else if (q.type === "radio") {
      const s = typeof v === "string" && (q.options || []).includes(v) ? v : "";
      if (q.required && !s) errors[q.id] = "どれかを選んでください";
      clean[q.id] = s;
    } else {
      const s = typeof v === "string" ? v.trim().slice(0, MAX_TEXT) : "";
      if (q.required && !s) errors[q.id] = "入力してください";
      clean[q.id] = s;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, clean };
}

/** 回答の結果（最終確認で「校了します」を選んだか） */
export function resultOf(questions, answers) {
  const final = (questions || []).find((q) => q.type === "radio" && (q.options || []).includes(APPROVE_OPTION));
  if (!final) return null;
  const v = answers?.[final.id];
  if (v === APPROVE_OPTION) return "approved";
  if (v) return "revise";
  return null;
}

export const RESULT_LABEL = { approved: "校了", revise: "修正希望" };

/**
 * 回答のお知らせ
 *   作った人 … 受信トレイ＋サイドバーの件数（kind: proof_form）
 *   ほかのメンバー … サイドバー「校了フォーム登録」の件数だけ（kind: proof_form_badge。受信トレイには出さない）
 *   ここに並べたアドレスの人には、サイドバーの件数を出さない
 */
export const PROOF_BADGE_KIND = "proof_form_badge";
export const PROOF_BADGE_EXCLUDED_EMAILS = ["ryota.y@concept-village.co.jp"]; // 山根さん

/** 推測できない URL 用の文字（24 文字） */
export function newProofToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
