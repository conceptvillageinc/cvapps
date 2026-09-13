// コンセプト・ヴィレッジ デザイン料金マスタ
// 単価: 16,000円/h ベース、出し値（selling_price）を使用

export const DESIGN_FEE_MASTER = [
  {
    category: "ブランドロゴデザイン",
    items: [
      { name: "ブランドロゴデザイン（まっさらから）", detail: "BLUE PRINTを活用した事業・サービスの立ち位置整理・方向性明確化", hours: 9.375, unit_price: 16000, amount: 150000, selling_price: 150000 },
      { name: "ロゴデータ化・キレイ化（データ納品なし）モノクロ・簡易", detail: "トレース・DICカラー設定", hours: null, unit_price: null, amount: 5000, selling_price: 5000 },
      { name: "ロゴデータ化・キレイ化（データ納品なし）フルカラー・複雑", detail: "トレース・DICカラー設定", hours: null, unit_price: null, amount: 15000, selling_price: 15000 },
      { name: "ロゴデータ化・キレイ化（データ納品）＋ロゴ規定", detail: "トレース・ロゴ使用規定含む", hours: null, unit_price: null, amount: 35000, selling_price: 35000 },
      { name: "ブランドロゴ オプション：ブランド名考案", detail: "ブランド名から一緒に考案", hours: 3.0, unit_price: 16000, amount: 48000, selling_price: 50000 },
    ],
  },
  {
    category: "チラシデザイン",
    items: [
      { name: "チラシ ベースデザイン（A4表面のみ）", detail: "1〜2案（色変更or配置変更）、写真・テキスト完全支給", hours: 4.375, unit_price: 16000, amount: 70000, selling_price: 70000 },
      { name: "チラシ ベースデザイン（A4表面＋裏面）", detail: "1案、写真・テキスト完全支給", hours: 6.25, unit_price: 16000, amount: 100000, selling_price: 100000 },
      { name: "チラシ オプション：テキスト作成（ベーステキスト支給）", detail: "箇条書きテキストから作成", hours: 1.5, unit_price: 16000, amount: 24000, selling_price: 25000 },
      { name: "チラシ オプション：テキスト作成（ヒアリングから）", detail: "ヒアリングをしてテキスト作成", hours: 3.0, unit_price: 16000, amount: 48000, selling_price: 50000 },
    ],
  },
  {
    category: "リーフレットデザイン",
    items: [
      { name: "リーフレット ベースデザイン（A4）", detail: "1〜2案、写真・テキスト完全支給", hours: 5.0, unit_price: 16000, amount: 80000, selling_price: 80000 },
      { name: "リーフレット ベースデザイン（A3）", detail: "1〜2案、写真・テキスト完全支給", hours: 9.0, unit_price: 16000, amount: 144000, selling_price: 145000 },
      { name: "リーフレット オプション：イラスト作成", detail: "イラストベースデザイン", hours: 4.0, unit_price: 16000, amount: 64000, selling_price: 60000 },
      { name: "リーフレット オプション：テキスト作成 A4（ベーステキスト支給）", detail: "", hours: 1.5, unit_price: 16000, amount: 24000, selling_price: 25000 },
      { name: "リーフレット オプション：テキスト作成 A4（ヒアリングから）", detail: "", hours: 3.0, unit_price: 16000, amount: 48000, selling_price: 50000 },
      { name: "リーフレット オプション：テキスト作成 A3（ベーステキスト支給）", detail: "", hours: 2.0, unit_price: 16000, amount: 32000, selling_price: 35000 },
      { name: "リーフレット オプション：テキスト作成 A3（ヒアリングから）", detail: "", hours: 3.5, unit_price: 16000, amount: 56000, selling_price: 60000 },
    ],
  },
  {
    category: "パンフレットデザイン",
    items: [
      { name: "パンフレット ベースデザイン（8ページ）", detail: "1案、写真・テキスト完全支給", hours: 9.0, unit_price: 16000, amount: 144000, selling_price: 145000 },
      { name: "パンフレット ベースデザイン（12ページ）", detail: "1案、写真・テキスト完全支給", hours: 13.0, unit_price: 16000, amount: 208000, selling_price: 210000 },
      { name: "パンフレット ベースデザイン（16ページ）", detail: "1案、写真・テキスト完全支給", hours: 18.0, unit_price: 16000, amount: 288000, selling_price: 290000 },
      { name: "パンフレット ベースデザイン（20ページ）", detail: "1案、写真・テキスト完全支給", hours: 23.0, unit_price: 16000, amount: 368000, selling_price: 370000 },
      { name: "パンフレット オプション：テキスト作成 8p（ベーステキスト支給）", detail: "", hours: 3.0, unit_price: 16000, amount: 48000, selling_price: 50000 },
      { name: "パンフレット オプション：テキスト作成 8p（ヒアリングから）", detail: "", hours: 4.0, unit_price: 16000, amount: 64000, selling_price: 65000 },
      { name: "パンフレット オプション：テキスト作成 12p（ベーステキスト支給）", detail: "", hours: 4.0, unit_price: 16000, amount: 64000, selling_price: 65000 },
      { name: "パンフレット オプション：テキスト作成 12p（ヒアリングから）", detail: "", hours: 5.0, unit_price: 16000, amount: 80000, selling_price: 80000 },
      { name: "パンフレット オプション：テキスト作成 16p（ベーステキスト支給）", detail: "", hours: 5.0, unit_price: 16000, amount: 80000, selling_price: 80000 },
      { name: "パンフレット オプション：テキスト作成 16p（ヒアリングから）", detail: "", hours: 6.0, unit_price: 16000, amount: 96000, selling_price: 100000 },
      { name: "パンフレット オプション：テキスト作成 20p（ベーステキスト支給）", detail: "", hours: 5.0, unit_price: 16000, amount: 80000, selling_price: 80000 },
      { name: "パンフレット オプション：テキスト作成 20p（ヒアリングから）", detail: "", hours: 6.0, unit_price: 16000, amount: 96000, selling_price: 100000 },
    ],
  },
  {
    category: "名刺デザイン",
    items: [
      { name: "名刺 ベースデザイン（両面）", detail: "2〜3案、写真・テキスト完全支給", hours: 2.0, unit_price: 16000, amount: 32000, selling_price: 35000 },
      { name: "名刺 デザイン展開（1名あたり）", detail: "", hours: null, unit_price: 1000, amount: 1000, selling_price: 1000 },
      { name: "名刺 ベースデザイン（2つ折り）", detail: "1〜2案、写真・テキスト完全支給", hours: 2.8, unit_price: 16000, amount: 44800, selling_price: 45000 },
      { name: "名刺 デザイン展開・2つ折り（1名あたり）", detail: "", hours: null, unit_price: 1000, amount: 1000, selling_price: 1000 },
    ],
  },
  {
    category: "POPデザイン",
    items: [
      { name: "POP ベースデザイン", detail: "1〜2案、写真・テキスト完全支給", hours: 2.5, unit_price: 16000, amount: 40000, selling_price: 40000 },
      { name: "POP デザイン展開（入稿データ作成含む）", detail: "1案", hours: 1.0, unit_price: 16000, amount: 16000, selling_price: 20000 },
    ],
  },
  {
    category: "パネルデザイン",
    items: [
      { name: "パネル ベースデザイン", detail: "1〜2案、写真・テキスト完全支給", hours: 3.0, unit_price: 16000, amount: 48000, selling_price: 50000 },
      { name: "パネル デザイン展開（入稿データ作成含む）", detail: "1案", hours: 1.0, unit_price: 16000, amount: 16000, selling_price: 20000 },
    ],
  },
  {
    category: "のぼり旗デザイン",
    items: [
      { name: "のぼり旗 ベースデザイン", detail: "1〜2案、写真・テキスト完全支給", hours: 2.5, unit_price: 16000, amount: 40000, selling_price: 40000 },
      { name: "のぼり旗 デザイン展開（入稿データ作成含む）", detail: "1案", hours: 1.0, unit_price: 16000, amount: 16000, selling_price: 20000 },
    ],
  },
  {
    category: "テーブルクロスデザイン",
    items: [
      { name: "テーブルクロス ベースデザイン（入稿データ作成含む）", detail: "1〜2案、写真・テキスト完全支給", hours: 2.0, unit_price: 16000, amount: 32000, selling_price: 35000 },
    ],
  },
  {
    category: "ユニフォームデザイン",
    items: [
      { name: "ユニフォーム ベースデザイン（入稿データ作成含む）", detail: "1〜2案、写真・テキスト完全支給", hours: 1.5, unit_price: 16000, amount: 24000, selling_price: 25000 },
      { name: "ユニフォーム デザイン展開（入稿データ作成含む）", detail: "1案", hours: 1.0, unit_price: 10000, amount: 10000, selling_price: 10000 },
    ],
  },
  {
    category: "商品パッケージデザイン",
    items: [
      { name: "商品パッケージ ベースデザイン", detail: "1〜2案、写真・一括表示完全支給", hours: 5.0, unit_price: 16000, amount: 80000, selling_price: 80000 },
      { name: "商品パッケージ デザイン展開（入稿データ作成含む）", detail: "1案", hours: 1.0, unit_price: 16000, amount: 16000, selling_price: 20000 },
    ],
  },
  {
    category: "Webサイトデザイン（LPのみ）",
    items: [
      { name: "LP デザイン", detail: "1〜2案、写真・テキスト完全支給", hours: 10.0, unit_price: 16000, amount: 160000, selling_price: 160000 },
      { name: "LP 構築費", detail: "デザイン確定後", hours: 10.0, unit_price: 16000, amount: 160000, selling_price: 160000 },
    ],
  },
  {
    category: "Webサイトデザイン（複数ページ）",
    items: [
      { name: "Web TOPページ デザイン", detail: "1〜2案、写真・テキスト完全支給", hours: 12.0, unit_price: 16000, amount: 192000, selling_price: 195000 },
      { name: "Web TOP以外の主要ページ デザイン（1ページあたり）", detail: "TOPデザイン方向性確定後着手", hours: 3.0, unit_price: 16000, amount: 48000, selling_price: 50000 },
      { name: "Web プライバシーポリシー等テキスト中心ページ（1ページあたり）", detail: "", hours: 1.0, unit_price: 16000, amount: 16000, selling_price: 20000 },
      { name: "Web 問い合わせページ デザイン", detail: "", hours: 1.0, unit_price: 16000, amount: 16000, selling_price: 20000 },
      { name: "Web 構築費 TOPページ", detail: "", hours: null, unit_price: null, amount: 150000, selling_price: 200000 },
      { name: "Web 構築費 TOP以外の主要ページ（1ページあたり）", detail: "", hours: null, unit_price: null, amount: 30000, selling_price: 40000 },
      { name: "Web 構築費 プライバシーポリシー等（1ページあたり）", detail: "", hours: null, unit_price: null, amount: 25000, selling_price: 30000 },
      { name: "Web 構築費 問い合わせページ", detail: "", hours: null, unit_price: null, amount: 25000, selling_price: 30000 },
    ],
  },
  {
    category: "写真撮影",
    items: [
      { name: "写真撮影：商品撮影（3点まで）", detail: "", hours: 0.4, unit_price: 16000, amount: 6400, selling_price: 10000 },
      { name: "写真撮影：調理撮影（1商品2メニューまで）", detail: "", hours: 2.0, unit_price: 16000, amount: 32000, selling_price: 35000 },
      { name: "写真撮影：出張ロケ撮影（50〜100カット・移動30分〜1時間）", detail: "", hours: 2.5, unit_price: 16000, amount: 40000, selling_price: 40000 },
      { name: "写真撮影：出張ロケ撮影（50〜100カット・移動1時間〜2時間）", detail: "", hours: 3.0, unit_price: 16000, amount: 48000, selling_price: 50000 },
    ],
  },
];

export const DESIGN_CATEGORIES = DESIGN_FEE_MASTER.map(c => c.category);

export function getDesignItemsByCategory(category) {
  return DESIGN_FEE_MASTER.find(c => c.category === category)?.items || [];
}
