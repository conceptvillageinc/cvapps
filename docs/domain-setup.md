# 独自ドメイン（cv-ax.jp）の設定

> 2026-09-24 設定完了。本番 URL は `https://cv-ax.jp`（旧 `https://cvapps-delta.vercel.app` も引き続き使える）。

アプリの URL を `https://cvapps-delta.vercel.app` から `https://cv-ax.jp` にする手順。
アプリのコードにドメインは書かれていない（ログイン後の戻り先や短いリンクは開いている URL から作る）ので、
変更するのは Vercel・Value Domain・Supabase・Google Cloud の設定だけ。作業は 30 分程度、DNS の反映待ちが最大で数時間。

CoreServer（無料体験）はアプリには使わない。DNS を Vercel に向けるため、CoreServer 上のサイトは表示されなくなる（問題ない）。

## 1. Vercel にドメインを追加

1. Vercel → プロジェクト `cvapps` → **Settings → Domains**
2. `cv-ax.jp` を入力して **Add**。「www.cv-ax.jp も追加して cv-ax.jp にリダイレクトする」を選ぶ（推奨）
3. 追加すると「Invalid Configuration」と出て、必要な DNS レコードが表示される。通常は次の 2 つ
   - `cv-ax.jp` … **A レコード** `216.150.1.1`（Vercel の現在の推奨値。旧 `76.76.21.21` も動く）
   - `www.cv-ax.jp` … **CNAME** `cname.vercel-dns.com`
   ※ 画面に別の値が出た場合はそちらを使う

## 2. Value Domain で DNS を設定

1. Value Domain → **ドメイン → ドメインの設定操作 → cv-ax.jp → DNS 設定／URL 転送**
2. ネームサーバーが Value Domain のもの（`ns1.value-domain.com` など）になっていることを確認。CoreServer のネームサーバーになっていたら Value Domain のものに戻す
3. DNS レコード欄を次のようにする（既存の `a @` / `a www` / `a *` で CoreServer の IP を指す行は削除する。`mx` や `txt` の行があれば残す）

```
a @ 216.150.1.1
cname www cname.vercel-dns.com.
```

4. 保存。反映には数分〜数時間かかる。Vercel の Domains 画面で `cv-ax.jp` が **Valid Configuration** になれば完了（SSL 証明書は Vercel が自動で発行する）

## 3. Supabase のログイン設定

1. Supabase → プロジェクト → **Authentication → URL Configuration**
2. **Site URL** を `https://cv-ax.jp` に変更
3. **Redirect URLs** に `https://cv-ax.jp/**` を追加（`https://cvapps-delta.vercel.app/**` も当面は残す）
4. Save

これをしないと、新しい URL で Google ログインしたあとに旧 URL へ戻されたり、ログインが失敗する。

## 4. Google Cloud の OAuth クライアント

1. Google Cloud Console → **API とサービス → 認証情報** → Supabase ログイン用の OAuth クライアント
2. **承認済みの JavaScript 生成元** に `https://cv-ax.jp` を追加
3. **承認済みのリダイレクト URI** は Supabase の URL（`https://<project>.supabase.co/auth/v1/callback`）のままでよい。変更不要
4. 保存

## 5. 動作確認

1. シークレットウィンドウで `https://cv-ax.jp` を開く → ログイン画面 → Google でログイン → ダッシュボードが開く
2. 見積詳細の「リンクをコピー」が `https://cv-ax.jp/e/CV-…` になっている
3. 見積書のメール送付・PDF が動く（サーバー側の処理はドメインに依存しないので、そのまま動くはず）

確認できたら、社内に案内する URL を `https://cv-ax.jp` にする。旧 URL（cvapps-delta.vercel.app）もそのまま使えるので、ブックマークの切り替えは順次でよい。

## 補足

- `app.cv-ax.jp` のようなサブドメインにしたい場合は、手順 1 でそのサブドメインを追加し、Value Domain には `cname app cname.vercel-dns.com.` を入れる。手順 3・4 の URL もそれに合わせる
- ドメインの有効期限（2027-09-30）が切れるとアプリにアクセスできなくなる。Value Domain の自動更新を有効にしておく
- 将来 `@cv-ax.jp` のメールを使う場合は、Value Domain の DNS に `mx` レコードを足せばよく、アプリの設定は変わらない
