# Supabase セットアップ手順

Phase 2（データ層）と Phase 3（認証）で必要な、Supabase 側の設定手順です。
上から順に実行してください。

プロジェクト: `https://qtdesganhbxacbwhpdma.supabase.co`

---

## 1. スキーマを作成する

Supabase ダッシュボード → 左メニュー **SQL Editor** → **New query**

`supabase/migrations/0001_initial_schema.sql` の中身をすべて貼り付けて **Run**。

作成されるもの:

| 種類 | 内容 |
|---|---|
| テーブル8つ | `users` / `clients` / `print_vendors` / `price_masters` / `estimates` / `email_logs` / `system_settings` / `faq_items` |
| RLS | 全テーブルで有効。`public.users` に登録されたメンバーのみ全操作可 |
| トリガー | Googleログイン時に `public.users` を自動作成。`@concept-village.co.jp` 以外はここで弾く |

**確認**: 左メニュー **Table Editor** に8つのテーブルが並んでいればOKです。

---

## 2. 移行データを投入する

同じく **SQL Editor** で、別途お渡しした `seed_0002_data.sql` を貼り付けて **Run**。

投入される件数:

| テーブル | 件数 | 備考 |
|---|---|---|
| clients | 257 | 重複統合後（元は502件） |
| print_vendors | 10 | |
| price_masters | 3 | |
| system_settings | 5 | 掛け率・選択肢・備考テンプレート |
| faq_items | 2 | |
| estimates | 16 | サンプル3件は移行対象外 |

同じデータを2回実行しても重複しません（`legacy_id` で弾いています）。

> **users は投入されません。** `auth.users` と紐づくため、各メンバーが初めてGoogleでログインした
> 時点で自動作成されます。権限は全員 `admin` から始まります（Base44の現状と同じ）。

---

## 3. Googleログインを有効にする

### 3-1. Google Cloud 側

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成（既存でも可）
2. **APIとサービス → OAuth同意画面**
   - User Type: **内部（Internal）** ※Google Workspace管理下なら内部を選べます。
     内部にすると `@concept-village.co.jp` 以外は最初から入れません（二重の防御になります）
   - アプリ名: `CV見積アプリ`
3. **APIとサービス → 認証情報 → 認証情報を作成 → OAuth クライアント ID**
   - 種類: **ウェブアプリケーション**
   - **承認済みのリダイレクトURI** に次を追加:
     ```
     https://qtdesganhbxacbwhpdma.supabase.co/auth/v1/callback
     ```
4. 発行された **クライアントID** と **クライアントシークレット** を控える

### 3-2. Supabase 側

1. ダッシュボード → **Authentication → Sign In / Providers → Google**
2. **Enable** をオンにして、上で控えたクライアントID・シークレットを貼り付け → Save
3. **Authentication → URL Configuration**
   - **Site URL**: 本番のURL（Vercelデプロイ後に設定。開発中は `http://localhost:5173`）
   - **Redirect URLs** に次の2つを追加:
     ```
     http://localhost:5173/**
     https://<Vercelの本番ドメイン>/**
     ```

> **メール／パスワードでのサインアップは無効にしてください**（Googleのみに統一するため）。
> **Authentication → Sign In / Providers → Email** を無効化します。

---

## 4. Vercel へデプロイする

1. [vercel.com](https://vercel.com/) に GitHub アカウントでログイン
2. **Add New → Project** → `conceptvillageinc/cvapps` を **Import**
3. 設定はほぼ自動検出されます（Framework: Vite / Build: `npm run build` / Output: `dist`）。
   **Environment Variables** に次の2つだけ追加してください:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://qtdesganhbxacbwhpdma.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...`（Supabaseの Project Settings → API Keys） |

4. **Deploy**

デプロイ後、`https://<プロジェクト名>.vercel.app` のようなURLが発行されます。

### デプロイ後にSupabase側を更新する

**Authentication → URL Configuration** を開き、発行されたURLを設定します:

- **Site URL**: `https://<発行されたURL>`
- **Redirect URLs**: `https://<発行されたURL>/**` を追加

> Google Cloud 側のリダイレクトURIは変更不要です。
> Google → Supabase → アプリ の順に転送されるため、Googleが知る必要があるのは
> Supabaseのコールバックだけです。

### ローカルで動かす場合

```bash
cp .env.example .env.local
# .env.local に VITE_SUPABASE_URL と VITE_SUPABASE_PUBLISHABLE_KEY を記入
npm install
npm run dev
```

この場合は Supabase の Redirect URLs に `http://localhost:5173/**` も追加してください。

### 動作確認

URLを開いてGoogleでログイン。見積一覧・クライアント一覧にデータが表示されれば
Phase 2・3 は成功です。

---

## 5. 鍵の扱い

| 鍵 | 置き場所 | 性質 |
|---|---|---|
| publishable key（旧 anon key） | `.env.local` / Vercel環境変数（`VITE_` 付き） | **公開前提**。ブラウザに載る。アクセス制御はRLSが担う |
| service_role key | Vercel環境変数のみ（`VITE_` を**付けない**） | **秘密**。RLSを無視できる管理者権限。ブラウザに絶対出さない |

`VITE_` を付けた環境変数はビルド時にJavaScriptへ埋め込まれます。
サーバー専用の値には決して `VITE_` を付けないでください。

---

## トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| ログイン後に「利用者として登録されていません」と出る | `public.users` に行がない。トリガーが動いたか SQL Editor で `select * from public.users;` を確認 |
| ログイン自体がエラーになる | 許可ドメイン外のアカウント。`@concept-village.co.jp` でログインしてください |
| データが空で表示される | RLSで弾かれている可能性。`public.users` に自分の行があるか確認 |
| `Supabase の接続情報が設定されていません` | `.env.local` が無いか、変数名が違う。`.env.example` と見比べてください |
