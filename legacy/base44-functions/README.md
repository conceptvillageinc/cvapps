# Base44 サーバー関数（移植元・参照用）

Base44 上で動いていたサーバー関数（Deno ランタイム）のソース。
**ビルド対象ではありません。** Phase 4 で Vercel Functions へ移植するための参照として保持しています。

| ファイル | 役割 | 移植時の注意 |
|---|---|---|
| `fetchPriceFromUrl.ts` | 印刷会社の価格ページを取得し、枚数×納期の価格表をAIで抽出 | `base44.asServiceRole.integrations.Core.InvokeLLM` → Claude API 直呼び出しに置き換え。認証は Supabase のセッション検証に置き換え |
| `collectWebPrices.ts` | ネット印刷4社の価格をAIで推定収集 | 同上。4社並行実行（`Promise.all`）の構造はそのまま流用可能 |

## 移植時のポイント

- **ランタイム**: Deno (`Deno.serve`) → Node (Vercel Functions のハンドラ)
- **認証**: `createClientFromRequest(req)` + `base44.auth.me()` → Supabase のアクセストークン検証
- **LLM**: `InvokeLLM`（`response_json_schema` で構造化出力）→ Claude API の tool use / structured output
- **APIキー**: 必ず Vercel の環境変数に置く。ブラウザには絶対に出さない
- `collectWebPrices` の価格は**AIによる推定値**であり、実サイトの取得値ではない点に注意（UI側にもその旨の警告表示あり）
