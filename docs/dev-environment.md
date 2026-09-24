# dev 環境（dev.cv-ax.jp）と本番（cv-ax.jp）の分け方

更新はまず dev に出し、動作確認が済んだものだけを本番に出す運用にする。

| 環境 | URL | Git ブランチ | Supabase プロジェクト |
|---|---|---|---|
| 本番 | https://cv-ax.jp | `main` | 既存（`qtdesganhbxacbwhpdma`） |
| dev | https://dev.cv-ax.jp | `develop` | 新規（`cvapps-dev`） |

`cvapps-delta.vercel.app` は Vercel が本番デプロイに付ける固定の名前で、常に本番と同じ内容になる（dev には使えない）。

## 更新の流れ

1. Claude が `develop` にプッシュ → Vercel が `dev.cv-ax.jp` に自動デプロイ
2. dev で動作確認。DB の変更（`supabase/migrations/00xx_*.sql`）があるときは **dev の Supabase** の SQL Editor で先に実行して確認
3. OK の連絡を受けて Claude が `develop` を `main` に取り込む → `cv-ax.jp` に自動デプロイ
4. DB の変更があるときは、本番デプロイの前後で **本番の Supabase** でも同じ SQL を実行

## 初期セットアップ（1回だけ）

### A. dev 用 Supabase プロジェクトを作る

1. Supabase ダッシュボード → 組織 `concept-village inc` → **New project**
   - Name: `cvapps-dev`
   - Region: Northeast Asia (Tokyo)
   - Database password: 生成されたものを保存（パスワード管理ツールへ。共有シートには書かない）
2. 作成後、**SQL Editor → New query** に `supabase/dev/all_migrations.sql` の中身を丸ごと貼り付けて **Run**
   （0001〜0014 を1本にしたもの。約 60KB。冪等なので失敗したら直して再実行してよい）
3. **Authentication → Providers → Google** を有効にし、本番と同じ **Client ID / Client Secret** を入れる（Google Cloud の同じ OAuth クライアントを使い回す）。表示される **Callback URL**（`https://<dev-project>.supabase.co/auth/v1/callback`）を控える
4. **Authentication → URL Configuration**
   - Site URL: `https://dev.cv-ax.jp`
   - Redirect URLs: `https://dev.cv-ax.jp/**`
5. **Project Settings → API Keys** で次を控える（後で Vercel に入れる）
   - Project URL（`https://<dev-project>.supabase.co`）
   - Publishable key（`sb_publishable_…`）
   - Service role key（Secret。画面に出さない）

dev で最初に Google ログインした人は自動で管理者になる（利用者が 0 人のときの救済ルール）。2人目以降は「ユーザー管理」から招待する。

### B. Google Cloud（OAuth クライアント）

「API とサービス → 認証情報」→ ウェブ アプリケーションのクライアント
- **承認済みのリダイレクト URI** に A-3 で控えた dev の Callback URL を追加
- **承認済みの JavaScript 生成元** に `https://dev.cv-ax.jp` を追加
- 保存

### C. Value Domain（DNS）

DNS 設定に 1 行追加（既存の 2 行は残す）。

```
cname dev cname.vercel-dns.com.
```

### D. Vercel

1. **Settings → Git → Production Branch** を `main` にする
2. **Settings → Domains** で `dev.cv-ax.jp` を追加 → その行の **編集** → **Git Branch** に `develop` を指定して保存
   （これで `develop` へのプッシュが `dev.cv-ax.jp` に出る。DNS 反映後に「有効な構成」になる）
3. **Settings → Environment Variables** で、次の 3 つを **Preview 環境だけ** dev の値に上書きする（Production の値は触らない）
   - `VITE_SUPABASE_URL` … dev の Project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` … dev の Publishable key
   - `SUPABASE_SERVICE_ROLE_KEY` … dev の Service role key（Secret）
   - `SUPABASE_URL` を設定している場合はそれも dev の Project URL に

   同じ変数名で Environment のチェックを **Preview** だけにして追加する（既存の Production 用と並んで 2 行になる）。
   `ANTHROPIC_API_KEY`・`GMAIL_*`・`GOOGLE_*`・`CRON_SECRET` は本番と共通でよい（Preview にもチェックが付いていることを確認）
4. Deployments で `develop` の最新デプロイを **Redeploy**（環境変数の変更はビルドし直さないと効かない）

### E. 動作確認

- `https://dev.cv-ax.jp` を開いて Google ログイン → ダッシュボード
- 見積を1件作り、PDF・メール送付（自分宛のクライアントを作って）・案件の作成が動くこと
- 本番（`cv-ax.jp`）にそのデータが**現れない**こと（DB が分かれている確認）

### F. dev にデータを入れる（任意）

dev は空の状態から始まる。本番と同じデータで試したい場合は、本番の Supabase の
**Database → Backups** から取ったダンプを dev に流すか、Claude に「本番のデータを dev にコピーしたい」と伝える（コピー用のスクリプトを用意する）。
マスタ（クライアント・印刷所・価格マスタ）だけなら `supabase/seed_0002_data.sql`（ローカルにあるもの。Git には入っていない）を dev の SQL Editor で実行すればよい。

## 注意

- **cron（定期売上の自動生成）は本番デプロイでしか動かない**（Vercel の仕様）。dev で試すときは `GET /api/recurring-projects` を手で呼ぶ
- メール送信は dev でも実際に送られる。テストは自分のアドレスを登録したクライアントで行う
- Google スプレッドシート出力は dev でも本物のドライブに作られる（タイトルに案件番号が付くので区別できる）
- dev の Supabase は Pro 組織内の 2 つ目のプロジェクトとして月 10 ドル程度かかる。使わない期間は **Pause project** で止められる（再開はダッシュボードから）
