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

### Phase 1: リポジトリ投入 ← 進行中
- [x] ブランチ作成・ディレクトリ構成
- [x] ビルド設定（vite / tailwind / postcss / eslint / jsconfig / components.json）
- [x] `@base44/vite-plugin` の除去
- [x] コアロジック（constants / estimateNumber / postalCode / utils）
- [x] アプリ骨格（App.jsx / Layout.jsx / AuthContext / ProtectedRoute ほか）
- [ ] `src/lib/designFees.js`
- [ ] `src/components/estimates/*`（12ファイル）
- [ ] `src/pages/*`（12ファイル）
- [ ] `src/components/ui/*`（49ファイル）
- [ ] `base44/functions/*`（サーバー関数2本・移植元として保持）
- [ ] `npm install` と `npm run build` が通ることの確認

### Phase 2: データ層の置き換え
- Supabaseプロジェクト作成、Postgresスキーマ設計（8エンティティ → テーブル）
- freee関連3フィールドを削除、`schema_version` の扱いを整理
- RLS（Row Level Security）ポリシー設計
- 実データ移行（サンプル3件を除く）
- `src/api/entities.js` アダプタ層を導入し、Base44 SDK → Supabase へ差し替え

### Phase 3: 認証の置き換え
- Supabase Auth + Googleプロバイダ（`concept-village.co.jp` ドメイン制限）
- `AuthContext.jsx` の書き換え、`app-params.js` の削除
- Register / ForgotPassword / ResetPassword / OAuthConsent の削除
- UserManagement の招待フロー再実装

### Phase 4: サーバー処理の移植
- `fetchPriceFromUrl` / `collectWebPrices` を Vercel Functions へ
- InvokeLLM 4箇所を Claude API 呼び出しへ（サーバー側）
- UploadFile を Supabase Storage へ

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
- Vercelデプロイ、独自ドメイン設定
- 動作確認後、Base44アプリを解約

## 6. 今後の機能追加（移行後）
- 工程管理表の作成機能（→ Phase 5 のスプレッドシート出力に接続）

## 7. 留意点
- `EmailPreview.jsx` の送信処理は `EmailLog` への記録のみで、実際のメール送信経路が未確認。Phase 4で要確認。
- `package.json` には Base44テンプレート由来の未使用依存（three / stripe / leaflet など）が残っている。
  ビルドが通るようになった段階で棚卸しする。
- `Estimate` は `schema_version` 1（旧方式）と 2（新方式 line_items）が混在。移行時に整理方針を決める。
