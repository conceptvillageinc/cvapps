# CV見積アプリ Base44脱却・移行計画

Base44で構築した「CV見積アプリ」を、Base44に依存しない自前環境（Claude Codeで開発・保守できる形）へ移行するための計画書。

最終更新: 2026-09-12

---

## 1. 移行の前提（確定事項）

| 項目 | 決定内容 |
|---|---|
| バックエンド | Supabase（Postgres / 認証 / ストレージ） |
| ホスティング・サーバー処理 | Vercel（静的配信 + Vercel Functions + Cron） |
| フロントエンド | 現行の React 18 + Vite + Tailwind + shadcn/ui をそのまま流用（Next.js化はしない） |
| 認証 | **Googleログインのみ**。メール+パスワード / OTP / パスワードリセットは廃止 |
| データ移行 | サンプル3件（CV-SAMPLE001〜003）を除き、実データのみ移行 |
| 本番運用状況 | 未運用。並行稼働・差分同期は不要 |
| freee連携 | **不要**（`freee_deal_id` / `freee_estimate_id` / `freee_status` は新DBから削除） |
| 外部連携（新規） | Googleスプレッドシート連携、MF会計連携 |
| 進め方 | Phaseごとに確認しながら進める |

## 2. 移行元の現状

**Base44アプリ**: `CV見積アプリ`（App ID: `6a21e48c312d5fd1b17c07cb`）
※ 別途 `CV見積アプリ (Copy)`（`6a53f4f76cb3fc7a41a27287`）も存在するが、移行元は上記を正とする。

### 画面（12本）
Dashboard / EstimateCreate / EstimateList / EstimateDetail / EstimateHistory /
PriceMasterList / ClientManagement / VendorManagement / SystemSettings /
UserManagement / FaqPage / 認証系（Login・Register・ForgotPassword・ResetPassword・OAuthConsent）

### エンティティ（8種）
Estimate / PriceMaster / Client / PrintVendor / EmailLog / SystemSettings / FaqItem / User

### サーバー関数（2本）
- `fetchPriceFromUrl` — 印刷会社のWebページから価格表を取得
- `collectWebPrices` — ネット印刷各社の価格を横断収集

### データ量（移行時点）
- Estimate: 19件（うちサンプル3件）
- PriceMaster: 3件
- User: 5名（全員 @concept-village.co.jp / 全員admin）

## 3. Base44依存の棚卸しと置き換え先

| 依存 | 使用箇所 | 置き換え先 |
|---|---|---|
| `base44.entities.*`（CRUD） | 約50箇所 / 13ファイル | Supabase (Postgres) — アダプタ層経由 |
| `base44.auth.*` | 認証系5ファイル | Supabase Auth（Googleのみ） |
| `base44.users.inviteUser` | UserManagement | 招待フローを自前実装 |
| `base44.integrations.Core.InvokeLLM` | 4箇所 | **Claude API**（Vercel Functions経由・APIキーはサーバー側） |
| `base44.integrations.Core.UploadFile` | 3箇所 | Supabase Storage |
| `base44.functions.invoke` | 2箇所 | Vercel Functions |
| `@base44/vite-plugin` | ビルド時 | **削除済み**（Phase 1で対応） |
| Base44ホスティング | — | Vercel |

### InvokeLLM の利用箇所（Claude APIへの置き換え対象）
1. `PriceMasterList.jsx` — 価格表スクリーンショット/URLからの価格グリッド抽出（2箇所）
2. `FaqPage.jsx` — FAQの自動回答生成
3. `estimates/VendorQuoteFileImporter.jsx` — 仕入先見積ファイルの取り込み
4. `estimates/EmailPreview.jsx` — 依頼メール文面の生成

> **重要**: APIキーは必ずサーバー側（Vercel Functions）に置くこと。ブラウザには絶対に出さない。

## 4. 移行方針：アダプタ層を先に作る

50箇所ある `base44.entities.*` の呼び出しを一斉に書き換えるのではなく、
同じインターフェースを持つアダプタ層を挟み、**中身だけを1エンティティずつ差し替える**。

```
src/api/entities.js   ← list / filter / create / update / delete を同じ形で公開
      ↓ 実装だけ差し替える
Base44 SDK   →   Supabase
```

途中で作業が止まっても動く状態が保たれ、差分も追いやすい。

## 5. フェーズ

### Phase 1: リポジトリ投入 ✅ 完了
- [x] ブランチ作成・ディレクトリ構成
- [x] ビルド設定（vite / tailwind / postcss / eslint / jsconfig / components.json）
- [x] `@base44/vite-plugin` の除去と、`@/` エイリアスの明示的な定義
- [x] コアロジック（constants / designFees / estimateNumber / postalCode / utils）
- [x] アプリ骨格（App.jsx / Layout.jsx / AuthContext / ProtectedRoute ほか）
- [x] `src/components/estimates/*`（12ファイル）
- [x] `src/pages/*`（11画面。認証4画面は方針により対象外）
- [x] `src/components/ui/*`（実際に使用している17件のみ）
- [x] `legacy/base44-functions/`（サーバー関数2本・移植元として保持）
- [x] `npm install` / `npm run build` / `npm run lint` がすべて通ることを確認

#### Phase 1 で加えた変更（Base44からの単純コピーではない点）
1. **`@base44/vite-plugin` を削除** — Base44 のビルド時プラグイン。これが `@/` → `src/` の
   エイリアスを提供していたため、`vite.config.js` に `resolve.alias` を明示的に追加した。
2. **認証4画面を移送対象外** — Googleログインのみとする決定に基づき、
   Register / ForgotPassword / ResetPassword / OAuthConsent は移送せず、
   `App.jsx` から該当ルートと import を削除。
3. **UIコンポーネントは17件のみ移送** — Base44テンプレート由来の shadcn/ui 49件のうち、
   実際に import されているのは17件だけだった。残り32件（sidebar / chart / carousel 等）は未使用のため見送り。
   将来必要になれば `npx shadcn@latest add <name>` で追加できる。
4. **未使用依存を削除** — package.json から three / stripe / leaflet / recharts / framer-motion /
   jspdf / html2canvas / moment / lodash / zod 等、実際には import されていない約40パッケージを削除
   （インストール 613 → 414 パッケージ）。削除後もビルドが通ることを確認済み。
5. **トースト通知の不具合を修正** — 下記「留意点」参照。

### Phase 2: データ層の置き換え ✅ 完了
- [x] Supabaseプロジェクト作成（`qtdesganhbxacbwhpdma`）
- [x] Postgresスキーマ設計 → `supabase/migrations/0001_initial_schema.sql`（8テーブル）
- [x] freee関連3フィールドと `deal_status`（旧・未使用）を削除
- [x] RLSポリシー：`public.users` に登録されたメンバーのみ全操作可
- [x] データ移行SQLの生成 → `scripts/generate-seed.mjs`
- [x] アダプタ層 `src/api/db.js` を導入し、Base44 SDK → Supabase へ差し替え
- [x] `@base44/sdk` を package.json から削除（Base44への依存が完全に消えた）

#### スキーマ設計の判断
- **`line_items`（新方式）を主とするが、旧方式のカラムも残した。**
  旧形式7件のうち4件にデザイン費データがあり、変換は可能だが、
  旧形式の画面にぶら下がる「見積書PDF取込」「ネット印刷価格収集」が
  新方式の画面にまだ繋がっていない。データを失わずに保持しておき、
  UIの一本化は機能の移植とあわせて後のフェーズで判断する。
- **未定義だった2フィールドを正式化**：`clients.quote_count`、`estimates.client_honorific`。
  どちらも画面では使われているのに Base44 のスキーマに定義が無かった。
- **`created_date` / `updated_date` → `created_at` / `updated_at`。**
  画面側は旧名で参照しているため、読み替えはアダプタ層が行う。

#### 移行時に行ったデータクリーンアップ
- **クライアントの重複統合：502件 → 257件。**
  freeeからのインポートが2回走っており、ほぼ全件が2重登録されていた。
  246グループのうち237グループは中身も完全一致だったため自動統合。
  項目ごとに非空の値を採用し、`quote_count` は最大値を採用。
- **郵便番号の正規化：206件。**
  `〒028-1105` / `969-2751` / `9700228` と3通りの表記が混在していた。
  `src/lib/postalCode.js` が期待するハイフンなし7桁に統一。

### Phase 3: 認証の置き換え ✅ 完了
データ層を動かすには認証が不可欠なため、必要な範囲をPhase 2で先に実装した。
- [x] Supabase Auth + Googleプロバイダ
- [x] ドメイン制限：`@concept-village.co.jp` 以外はDBトリガーでサインアップ自体を拒否
- [x] `AuthContext.jsx` の書き換え、`app-params.js` / `authReturnTo.js` / `base44Client.js` の削除
- [x] Login画面をGoogleログインのみに簡素化
- [x] Google Cloud側のOAuth設定（`docs/supabase-setup.md` 手順3）
- [x] 本番URLでの動作確認（ログイン・一覧表示・新規作成・URL直打ち）
- [ ] UserManagement の招待フロー再実装（現状は呼ぶとエラーになる。Phase 4 へ送る）
- [ ] `PageNotFound.jsx` の管理者向け文言がBase44前提のまま（軽微）

### Phase 4-A: ファイル保管とAI機能 ✅ 完了
手順は `docs/phase4-setup.md`。
- [x] Supabase Storage（非公開バケット `uploads`）へ UploadFile を移植
- [x] `/api/llm`（Vercel Function）経由で Claude API を呼ぶ形に InvokeLLM 4箇所を移植
- [x] 呼び出し元のJWT検証（`api/_lib/guard.js`）。ログイン済みメンバー以外は 401/403
- [x] 画面側に残っていた古いモデルID `claude_opus_4_8` の指定を削除（モデルはサーバーが決める）
- [x] Storage バケット作成・Vercel環境変数3つ・Redeploy
- [x] 本番で4機能すべて動作確認（FAQ回答 / メール生成 / 見積書PDF取込 / 価格表スクショ取込）

### Phase A-1: 仕入先見積の取込を新形式へ ✅ 完了（本番動作確認済み）
新形式（schema_version 2）の見積書タブに「仕入先見積から読込」を追加。
- 旧形式は「各社見積価格」の比較表に入れていたが、新形式に比較表は無い。
  読み取った金額を各明細の**原価**として取り込み、掛け率を掛けた額を出し値にした。
  こうすると新形式の粗利計算がそのまま効く。
- 抽出プロンプトとスキーマは `src/lib/vendorQuote.js` に集約し、旧形式側も
  そこを参照するよう変更（読み取り精度の調整が片方にしか効かない状態を解消）。
- **掛け率の計算に1円ずれるバグがあったため修正**（6箇所）。
  `Math.ceil(12000 * 1.35)` は浮動小数点誤差で 16201 になる。
  `applyMarkup()` に集約し、まるめてから切り上げるようにした。

### Phase A-2: メール生成を新形式へ ✅ 完了（本番動作確認済み）
- 新形式は印刷物種別を持たないため、**印刷所マスタ（種別=メール）から人が宛先を選ぶ**方式にした。
  明細からAIに宛先を推測させる案もあったが、誤って別の会社に依頼が飛ぶと気づきにくいため、
  確実性を優先している。
- 旧形式は従来どおり印刷物種別から宛先を初期選択する（動作を変えていない）。
- 依頼に載せる仕様テキストは、旧形式は仕様欄から、新形式は明細行から組み立てる
  （`src/lib/estimateEmail.js`）。テキスト行（見出し・注記）は仕様に混ぜない。
- **生成に失敗しても画面に何も出ないバグを修正**。従来は例外が握りつぶされ、
  ボタンを押しても無反応に見えていた。

### Phase A-3: 残り
- [ ] ネット印刷価格収集を新形式へ（**Phase 4-C のサーバー関数移植が前提**）

### Phase 4-B / 4-C: 残り
- [ ] メンバー招待（`users.inviteUser`）を Supabase Admin API へ
- [ ] `fetchPriceFromUrl` / `collectWebPrices` を Vercel Functions へ（定期実行の設計込み）

### Phase 4: 対象一覧
Base44 に残っている最後の依存。呼び出し箇所は8つ。

| 対象 | 箇所 | 移植先 |
|---|---|---|
| `UploadFile` 3箇所 | 見積書PDF取込 / 価格表スクショ2箇所 | Supabase Storage（非公開バケット＋署名URL） |
| `InvokeLLM` 4箇所 | メール文面生成 / FAQ回答 / 見積書PDF読取 / 価格表スクショ読取 | Vercel Function 経由で Claude API |
| `functions.invoke` 2種 | `fetchPriceFromUrl` / `collectWebPrices` | Vercel Functions（Deno→Node へ移植） |
| `users.inviteUser` | メンバー招待 | Supabase Admin API（service_role をサーバー側で使用） |

設計方針:
- **APIキーはブラウザに出さない。** `ANTHROPIC_API_KEY` は Vercel の環境変数
  （`VITE_` を付けない）に置き、`/api/*` の Function からのみ使う
- Function 側で Supabase の JWT を検証し、ログイン済みメンバー以外は 401 を返す
  （そうしないとAPIキーの踏み台にされる）
- 画面側の呼び出し形（`db.integrations.Core.InvokeLLM` 等）は変えない。
  アダプタ層 `src/api/db.js` の中身だけ差し替える
- モデルIDは `claude_opus_4_8` のまま放置されているので現行IDへ更新する

### Phase 5: 外部連携
- **Googleスプレッドシート**: サービスアカウント方式。
  会社の**共有ドライブ**を1つ作り、そこにサービスアカウントをメンバー追加する。
  （これをしないと、生成したシートがサービスアカウント個人の領域に作られ社内から見えない）
  - 見積データのシート書き出し
  - 工程管理表の自動出力 → クライアントへ共有リンクを発行
  - 仕組みは共通化する: テンプレをコピー → データ流し込み → 権限設定 → リンク返却
- **MF会計**: 2段階で進める。
  1. まず MFの仕訳インポート形式で **CSV書き出し**（サーバー処理不要・すぐ作れる）
  2. API条件（申請・契約・対象プラン）を確認のうえ **API直結** へ差し替え
  - DB設計の段階で、後からAPI直結に差し替えられる形にしておく

### Phase 6: 本番切替とBase44解約
- [x] Vercelデプロイ（Proプラン）
- [ ] 独自ドメイン設定
- [ ] 動作確認後、Base44アプリを解約

## 6. 今後の機能追加（移行後）
- 工程管理表の作成機能（→ Phase 5 のスプレッドシート出力に接続）

## 7. 留意点・移行中に見つかった課題

### 修正済み：トースト通知が一切表示されていなかった（Base44版からのバグ）
アプリ全体で `toast.success(...)` などの通知に **sonner** を使っているが、
`App.jsx` がマウントしていたのは **Radix UI ベースの別のトースター**（`@/components/ui/toaster`）だった。
sonner の通知を表示するには sonner 自身の `<Toaster />` が必要なため、
「保存しました」「削除しました」等の通知が**どの画面でも表示されない状態**だった
（Radix側の `useToast()` はどこからも呼ばれておらず、完全に死んでいた）。

Phase 1 で `App.jsx` のマウント先を sonner の `<Toaster />` に変更し、
未使用の Radix トースト3ファイル（toaster / toast / use-toast）は移送対象から外した。
**移行後の動作確認時に、通知が出るようになっているかを確認してください。**

### 未解決・Phase 2以降で判断が必要
- **メール送信が実装されていない** — `EmailPreview.jsx` の「送信記録」ボタンは `EmailLog` に
  レコードを作るだけで、実際のメール送信は行っていない。実運用で送信まで必要なら Phase 4 で設計が必要。
- **`client_honorific` がスキーマ未定義** — `QuoteEditor.jsx` が読み書きしているが、
  Base44 の Estimate スキーマには定義がない。Phase 2 のDB設計で正式なカラムとして追加する。
- **`Estimate` に旧方式と新方式が混在** — `schema_version` 1（cost_price/design_fees中心）と
  2（line_items中心）。画面も分岐している。移行時に「旧方式を残すか、2に一本化するか」を決める。
- **AIモデル指定が古い** — `VendorQuoteFileImporter.jsx` と `PriceMasterList.jsx` で
  `model: "claude_opus_4_8"` を指定している。Phase 4 の Claude API 移植時に現行モデルへ更新する。
- **ネット印刷の価格収集はAIの推定値** — `collectWebPrices` は実サイトから価格を取得しておらず、
  AIに推定させている。実用上の精度は要検証（UI上にも警告表示あり）。
- **バンドルサイズ 823KB（gzip 246KB）** — 単一チャンク。運用上の実害が出たらコード分割を検討。
