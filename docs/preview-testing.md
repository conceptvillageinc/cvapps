# 本番に出す前に別環境で試す（Vercel のプレビュー）

dev 環境（dev.cv-ax.jp）が用意できるまでの暫定の手順。
本番の Git ブランチ以外にプッシュすると、Vercel が「プレビュー」を自動で作る。
コードは新しいもの、DB と Storage は本番と共通（dev の Supabase ができるまで）。

## 1 回だけの準備（Vercel / Supabase）

1. Vercel → Settings → Environment Variables で、各変数の Environment に **Preview** が含まれているか確認する
   （`VITE_SUPABASE_URL` `VITE_SUPABASE_PUBLISHABLE_KEY` `SUPABASE_SERVICE_ROLE_KEY` `ANTHROPIC_API_KEY` `GEMINI_API_KEY` `GMAIL_*` `GOOGLE_*` `CRON_SECRET` など）。
   Production だけになっている変数は「編集」で Preview にもチェックを付ける。
2. Supabase → Authentication → URL Configuration → **Redirect URLs** に `https://*.vercel.app/**` を追加する
   （Google ログイン後にプレビューの URL へ戻れるようにする）。
3. Vercel → Settings → Deployment Protection が「Vercel Authentication」の場合、プレビューは Vercel にログインしているメンバーだけが開ける（それで問題ない）。

## 試すとき

1. Claude が `feature/…` ブランチにプッシュする。
2. Vercel → Deployments で、そのブランチ名の行（Preview）を開き「Visit」。URL は `cvapps-git-<ブランチ名>-<チーム>.vercel.app` の形。
3. 動作確認。データは本番と同じなので、テスト用の見積・案件で試す。
4. OK なら Claude が本番ブランチへ取り込む → cv-ax.jp に反映。

## 注意

- DB の変更（`supabase/migrations`）を含む機能は、本番の Supabase に SQL を先に流す必要がある（DB が共通のため）。
  その場合は dev 環境ができてから試す方が安全。
- プレビューでも Gmail 送信・cron は本番と同じ設定で動く。送信系は自分宛てで試す。
