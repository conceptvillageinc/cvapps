# CV見積アプリ

株式会社コンセプト・ヴィレッジの社内向け見積作成・管理アプリ。

Base44 上に構築されていたものを、Base44 に依存しない自前環境へ移行中です。
移行の全体計画・決定事項は **[docs/migration-plan.md](docs/migration-plan.md)** を参照してください。

## 技術構成

| 領域 | 現在 | 移行後（予定） |
|---|---|---|
| フロントエンド | React 18 + Vite + Tailwind + shadcn/ui | 同じ（そのまま継続） |
| データ | Base44 エンティティ（`@base44/sdk`） | Supabase (Postgres) |
| 認証 | Base44 Auth | Supabase Auth（Googleログインのみ） |
| サーバー処理 | Base44 Functions (Deno) | Vercel Functions |
| AI | Base44 `InvokeLLM` | Claude API（サーバー側） |
| ファイル | Base44 `UploadFile` | Supabase Storage |
| ホスティング | Base44 | Vercel |

## セットアップ

```bash
npm install
npm run dev     # 開発サーバー
npm run build   # 本番ビルド
npm run lint    # Lint
```

> **注意**: 現時点ではデータ層・認証層がまだ Base44 SDK を参照しているため、
> `npm run dev` で起動しても Base44 のバックエンドなしでは画面が動作しません。
> ビルドが通る状態までが Phase 1 の到達点です。実際に動くのは Phase 2・3 完了後です。

## ディレクトリ構成

```
src/
├── api/          Base44 クライアント（Phase 2 でアダプタ層に置き換え）
├── components/
│   ├── estimates/  見積関連コンポーネント（12件・業務ロジックの中核）
│   └── ui/         shadcn/ui コンポーネント（実際に使う17件のみ）
├── lib/          定数・デザイン費マスタ・見積番号採番・郵便番号ユーティリティ等
├── pages/        画面（11件）
└── hooks, utils

legacy/
└── base44-functions/  Base44 サーバー関数のソース（Phase 4 の移植元・ビルド対象外）

docs/
└── migration-plan.md  移行計画書
```
