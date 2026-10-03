# バックアップと復元

## 何がどこに残るか

| 種類 | 場所 | 頻度 |
|---|---|---|
| Supabase の自動バックアップ（データベース） | Supabase（Pro プラン） | 毎日。7 日分 |
| アプリからの書き出し（データベース＋ファイル） | Google ドライブ `バックアップ用フォルダ` | 毎週 月曜 4:00 JST（`/api/backup` の cron）。システム設定から手動でも可 |
| プログラム | GitHub `conceptvillageinc/cvapps` | 変更のたび |

ドライブのフォルダの中身:

- `database/cvapp-db-YYYY-MM-DD.zip` … 全テーブルの JSON と CSV、Storage のファイル一覧、README
- `files/` … Storage（uploads バケット）のファイルの写し。パスの `/` は `__` に置き換えた名前
- 直近 8 週分と、各月の最初の ZIP を 12 か月分残し、古いものは自動で消す

## 必要な設定（初回だけ）

1. Google Workspace の管理コンソール → セキュリティ → API の制御 → ドメイン全体の委任 で、工程管理表に使っているサービスアカウントのクライアント ID に、次のスコープを追加する。
   `https://www.googleapis.com/auth/drive`
2. Vercel の環境変数（任意。省略時は既定値）
   - `BACKUP_DRIVE_FOLDER_ID` … 保存先フォルダの ID（既定: info@ のドライブの「バックアップ用フォルダ」）
   - `BACKUP_DRIVE_OWNER` … フォルダの持ち主のアドレス（既定: info@concept-village.co.jp）
3. `CRON_SECRET` は既に設定済み（議事録の掃除と同じものを使う）

## 戻し方（Supabase が使えなくなったとき）

1. Supabase で新しいプロジェクトを作る（リージョンは東京）。
2. SQL Editor で `supabase/migrations` の SQL を 0001 から番号順にすべて実行する。
3. 手元の PC で、ドライブから最新の `cvapp-db-YYYY-MM-DD.zip` を取り、次を実行する。

   ```
   npm install
   SUPABASE_URL=https://<新しいプロジェクト>.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=<新しい service_role キー> \
   node scripts/restore-backup.mjs cvapp-db-YYYY-MM-DD.zip
   ```

   表の中身が親→子の順で入る。ユーザー表は入れない（認証の ID が変わるため）。
4. Storage: 新しいプロジェクトに非公開バケット `uploads` を作り、ドライブの `files/` のファイルを入れる（名前の `__` を `/` に戻す）。
5. Vercel の環境変数を新しいプロジェクトの値に変える（`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`）。Google ログインのリダイレクト先も Supabase の Authentication で設定し直す。
6. 管理者がログインし、ユーザー管理からメンバーを招待し直す。
7. 一度は実際に戻して確かめる。バックアップは「戻せること」を確かめて初めて意味がある。

## 注意

- ZIP に API キーなどの鍵は入らない。鍵は「各種アカウント情報」の管理に従う。
- 議事録の音声は保存期限を過ぎると消す運用なので、期限内のものだけが写る。
