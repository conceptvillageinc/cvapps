# CV見積アプリ

株式会社コンセプト・ヴィレッジの社内向け見積作成・管理アプリ。

Base44 上に構築されていたものを、Base44 に依存しない自前環境へ移行中です。
移行の全体計画・決定事項は **[docs/migration-plan.md](docs/migration-plan.md)** を参照してください。

## 技術構成

| 領域 | 現在 | 状態 |
|---|---|---|
| フロントエンド | React 18 + Vite + Tailwind + shadcn/ui | そのまま継続 |
| データ | **Supabase (Postgres)** | ✅ 移行済み |
| 認証 | **Supabase Auth（Googleログインのみ）** | ✅ 移行済み |
| サーバー処理 | **Vercel Functions** | 🔄 AI呼び出しは移行済み。価格収集は Phase 4-C |
| AI | **Claude API（サーバー側）** | ✅ 移行済み |
| ファイル | **Supabase Storage** | ✅ 移行済み |
| ホスティング | **Vercel** | ✅ デプロイ済み |

`@base44/sdk` への依存は削除済みです。未移行の機能（AI・ファイルアップロード・
サーバー関数・メンバー招待）は、呼ぶと「どのフェーズで実装予定か」を示すエラーになります。

## セットアップ

初回は **[docs/supabase-setup.md](docs/supabase-setup.md)** の手順（スキーマ作成・データ投入・
Googleログイン設定）を先に済ませてください。

```bash
cp .env.example .env.local   # Supabaseの接続情報を記入
npm install
npm run dev     # 開発サーバー
npm run build   # 本番ビルド
npm run lint    # Lint
```

## ディレクトリ構成

```
src/
├── api/db.js     データアクセスのアダプタ層（Base44 SDK と同じ形で Supabase を呼ぶ）
├── lib/supabase.js  Supabase クライアント
├── components/
│   ├── estimates/  見積関連コンポーネント（12件・業務ロジックの中核）
│   └── ui/         shadcn/ui コンポーネント（実際に使う17件のみ）
├── lib/          定数・デザイン費マスタ・見積番号採番・郵便番号ユーティリティ等
├── pages/        画面（11件）
└── hooks, utils

api/
├── llm.js        AI呼び出し（Claude API）。APIキーはここだけが持つ
└── _lib/         JWT検証・Claude呼び出しの共通処理

legacy/
└── base44-functions/  Base44 サーバー関数のソース（Phase 4 の移植元・ビルド対象外）

docs/
└── migration-plan.md  移行計画書
```
