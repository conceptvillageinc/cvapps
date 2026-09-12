// 見積作成担当者
export const PERSON_IN_CHARGE_OPTIONS = [
  "会田妃那子",
  "平地可奈",
  "小原みのり",
  "服部みさき",
  "寺山美奈",
  "服部奈々",
  "馬場大治",
  "山根良太",
  "石川諒大",
];

// ログイン中のメールアドレスから見積作成担当者の初期値を自動選択するための対応表
// （ドメインは concept-village.co.jp で統一）
export const EMAIL_TO_PERSON_MAP = {
  "hinako@concept-village.co.jp": "会田妃那子",
  "kana@concept-village.co.jp": "平地可奈",
  "minori@concept-village.co.jp": "小原みのり",
  "misaki@concept-village.co.jp": "服部みさき",
  "mina@concept-village.co.jp": "寺山美奈",
  "nana@concept-village.co.jp": "服部奈々",
  "daichi@concept-village.co.jp": "馬場大治",
  "ryota.y@concept-village.co.jp": "山根良太",
  "ryota@concept-village.co.jp": "石川諒大",
};

// 印刷物種別
export const PRINT_TYPES = [
  "パッケージラベル印刷",
  "箱印刷",
  "ユニフォーム",
  "ラベル印刷",
  "チラシ印刷",
  "ポスター印刷",
  "のぼり旗印刷",
  "パネル印刷",
];

// 紙質オプション
export const PAPER_TYPES = [
  "上質紙",
  "マットコート",
  "コート紙",
  "ユポ",
  "アート紙",
  "光沢紙",
  "マット紙",
  "タック紙",
  "合成紙",
  "その他",
];

// 掛け率ルール
export const MARKUP_RATES = {
  "パッケージラベル印刷": 1.25,
  "パッケージラベル印刷費": 1.25,
  default: 1.35,
};

export const getMarkupRate = (printType) => {
  return MARKUP_RATES[printType] || MARKUP_RATES.default;
};

// 新方式の見積明細で使う大カテゴリ
export const LINE_ITEM_CATEGORIES = [
  { key: "design", label: "デザイン費", source: "design_master" },
  { key: "print_paper", label: "印刷費（紙）", source: "price_master", paperGroup: "紙" },
  { key: "print_nonpaper", label: "印刷費（紙以外）", source: "price_master", paperGroup: "紙以外" },
  { key: "build", label: "構築費", source: "manual" },
  { key: "other", label: "自由入力", source: "manual" },
];

// 自社情報（見積書ヘッダー用）
export const COMPANY_INFO = {
  name: "株式会社コンセプト・ヴィレッジ",
  locations: [
    { label: "福島", postal: "〒963-0117", address: "福島県郡山市安積荒井三丁目497-B号 cv-studio" },
    { label: "沖縄", postal: "〒900-0033", address: "沖縄県那覇市久米２丁目９－１１ Abc久米ビル 3階" },
  ],
  tel: "024-905-1295",
  fax: "024-505-4866",
};

// 見積書の有効期限（デフォルト：何ヶ月後）
export const DEFAULT_VALIDITY_MONTHS = 6;

// 消費税率
export const TAX_RATE = 0.1;

// ステータスマッピング
export const STATUS_MAP = {
  draft: { label: "下書き", color: "bg-muted text-muted-foreground" },
  collecting: { label: "価格収集中", color: "bg-blue-100 text-blue-700" },
  calculating: { label: "計算中", color: "bg-purple-100 text-purple-700" },
  review_pending: { label: "レビュー待ち", color: "bg-amber-100 text-amber-700" },
  review_in_progress: { label: "レビュー中", color: "bg-orange-100 text-orange-700" },
  approved: { label: "承認済み", color: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "差し戻し", color: "bg-red-100 text-red-700" },
  sent_to_freee: { label: "freee連携済", color: "bg-teal-100 text-teal-700" },
};

// 商談結果ステータス（旧方式・未使用。deal_probabilityに置き換え）
export const DEAL_STATUS_MAP = {
  in_progress: { label: "進行中", color: "bg-slate-100 text-slate-700" },
  won: { label: "受注", color: "bg-emerald-100 text-emerald-700" },
  lost: { label: "失注", color: "bg-red-100 text-red-700" },
};

// 受注確度の色分け（マスタで追加された値はグレーにフォールバック）
export const DEAL_PROBABILITY_COLORS = {
  "A": "bg-emerald-100 text-emerald-700",
  "A（定期売上）": "bg-teal-100 text-teal-700",
  "要注意A": "bg-amber-100 text-amber-700",
  "B": "bg-blue-100 text-blue-700",
  "C": "bg-slate-100 text-slate-700",
  "失注": "bg-red-100 text-red-700",
};
export const getDealProbabilityColor = (label) => DEAL_PROBABILITY_COLORS[label] || "bg-muted text-muted-foreground";

// フェーズの色分け
export const PHASE_COLORS = {
  "未着手": "bg-muted text-muted-foreground",
  "着手中": "bg-blue-100 text-blue-700",
};
export const getPhaseColor = (label) => PHASE_COLORS[label] || "bg-muted text-muted-foreground";

// メール依頼先マッピング
export const EMAIL_VENDOR_MAP = {
  "パッケージラベル印刷": ["中澤水産", "東洋特殊印刷", "寺岡システム", "ふくほー商会", "ネット&プリント"],
  "箱印刷": ["吉川紙業"],
  "ユニフォーム": ["福島アレンジ"],
};

// ネット印刷対応種別
export const WEB_PRINT_TYPES = ["ラベル印刷", "チラシ印刷", "ポスター印刷", "のぼり旗印刷", "パネル印刷"];

// ネット印刷会社
export const WEB_VENDORS = ["グラフィック", "マツダプリント", "ラクスル", "プリントパック"];

// 承認チェックリスト
export const APPROVAL_CHECKLIST = [
  { key: "no_typos", label: "項目名称の誤字脱字はないか？" },
  { key: "clear_descriptions", label: "項目の表現はクライアントにわかりやすいか？" },
  { key: "cost_valid", label: "原価が出し値を上回っていないか？（原価 < 出し値 であること）" },
  { key: "profit_valid", label: "粗利額は適切か？（出し値 − 原価）" },
  { key: "delivery_noted", label: "希望納期は明記されているか？" },
  { key: "vendor_delivery_ok", label: "選定した印刷会社はクライアントの希望納期に対応可能か？" },
  { key: "fees_correct", label: "校正費等の付帯費用は正しく計上されているか？" },
];
