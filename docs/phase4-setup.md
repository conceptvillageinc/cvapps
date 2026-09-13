# Phase 4-A セットアップ手順（ファイル保管とAI機能）

見積書PDFの取り込み、価格表スクリーンショットの読み取り、メール文面の生成、
FAQの自動回答を Base44 から自前環境へ移しました。動かすために3つ設定が必要です。

---

## 1. Storage バケットを作る

Supabase ダッシュボード → **SQL Editor** → **New query**

`supabase/migrations/0002_storage.sql` の中身を貼り付けて **Run**。

`uploads` という**非公開**バケットができます。アップロードした見積書PDFや価格表の
スクリーンショットはここに入ります。

> **なぜ非公開か**: 中身は仕入先の見積書・価格表です。公開バケットにすると
> URLを知っている人は誰でも読めてしまいます。非公開にして、サーバー側だけが
> 中身を読める形にしています。

**確認**: 左メニュー **Storage** に `uploads` が表示されればOKです。

---

## 2. Vercel に環境変数を3つ追加する

Vercel → プロジェクト **cvapps** → **Settings → Environments → Production**
→ **Add Environment Variable**

| Key | Value | Type |
|---|---|---|
| `ANTHROPIC_API_KEY` | 発行したAPIキー（`sk-ant-...`） | **Secret** |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase の Project Settings → API Keys → `service_role` | **Secret** |
| `SUPABASE_URL` | `https://qtdesganhbxacbwhpdma.supabase.co` | Config |

### ⚠️ ここが今回一番重要です

**この3つには `VITE_` を付けないでください。**

`VITE_` を付けた変数はビルド時にJavaScriptへ埋め込まれ、**ブラウザで誰でも読めます**。
APIキーがそこに載ると、第三者に使われて課金だけされることになります。

Phase 2 で登録した2つとは扱いが逆になります。

| 変数 | `VITE_` | Type | 理由 |
|---|---|---|---|
| `VITE_SUPABASE_URL` | 付ける | Config | ブラウザから使う。公開前提 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 付ける | Config | 公開鍵。制御はRLSが担う |
| `ANTHROPIC_API_KEY` | **付けない** | **Secret** | 秘密。サーバーだけが使う |
| `SUPABASE_SERVICE_ROLE_KEY` | **付けない** | **Secret** | RLSを無視できる管理者権限 |
| `SUPABASE_URL` | 付けない | Config | サーバー側から使うURL |

> `service_role` key と APIキーは、このチャットや他の人に渡さないでください。
> Vercel の入力欄に直接貼り付けてください。

---

## 3. Redeploy する

環境変数はビルド時に読み込まれるため、追加しただけでは反映されません。

**Deployments** → 最新のデプロイの **「⋯」** → **Redeploy**

---

## 動作確認

| # | 画面 | 操作 | 期待される結果 |
|---|---|---|---|
| 1 | 見積詳細 → メール | 「AIでメール生成」 | 印刷会社ごとの依頼メール文面が出る |
| 2 | FAQ | 質問を入力して送信 | 回答が生成されQ&Aに登録される |
| 3 | 見積詳細 → 仕入先見積取込 | PDFを選択 | 会社名・明細行が読み取られ、編集パネルに入る |
| 4 | 価格マスタ | スクショで更新 | 価格表が読み取られグリッドに反映される |

3と4は数十秒かかることがあります（PDFの枚数によります）。

---

## 仕組み

```
ブラウザ ──① ファイルを Supabase Storage へ（非公開）
    │
    └──② /api/llm を呼ぶ（ログイン中のトークンを添えて）
              │
        Vercel Function
              │  ③ トークンを検証。public.users に居なければ 401/403
              │  ④ service_role で Storage からファイルを読む
              └──⑤ Claude API を呼ぶ（APIキーはここにしか無い）
```

③が無いと、`/api/llm` のURLを知った第三者が会社のAPIキーを使い放題になります。
**サーバー側に秘密鍵を置く関数を追加するときは、必ず `api/_lib/guard.js` の
`requireMember` を通してください。**

---

## 費用について

従量課金で、月額固定はありません。目安は次のとおりです。

| 操作 | 1回あたり |
|---|---|
| メール文面の生成 | 1円未満 |
| FAQの回答 | 1円未満 |
| 見積書PDFの読み取り | 数円 |
| 価格表スクショの読み取り | 数円 |

使用量は [console.anthropic.com](https://console.anthropic.com/) の Usage で確認できます。
想定外に増えていないか、最初の1か月は時々見ておくと安心です。
上限を決めたい場合は、同じ画面で **Usage limits** を設定できます。

---

## トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| `ANTHROPIC_API_KEY が未設定です` | Vercel に追加したあと Redeploy していない |
| `サーバー側の環境変数が未設定です` | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` の名前違い。`VITE_` を付けていないか確認 |
| `ファイルの保存に失敗しました` | 手順1のSQLを実行していない。Storage に `uploads` があるか確認 |
| `このアプリの利用者として登録されていません` | `public.users` に行が無い。一度ログアウトして入り直す |
| `AIの回答を読み取れませんでした` | 読み取り対象が不鮮明な可能性。解像度の高い画像で再試行 |
