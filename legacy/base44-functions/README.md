# Base44 サーバー関数（移植元・参照用）

Base44 上で動いていたサーバー関数（Deno ランタイム）のソース。
**ビルド対象ではありません。** Phase 4 で Vercel Functions へ移植するための参照として保持しています。

| ファイル | 役割 | 状況 |
|---|---|---|
| `fetchPriceFromUrl.ts` | 印刷会社の価格ページを取得し、枚数×納期の価格表をAIで抽出 | **移植済み** → `api/fetch-price.js` |

## 移植せずに廃止したもの

`collectWebPrices.ts`（ネット印刷4社の価格収集）は移植せず、機能ごと削除した。

この関数は各社のサイトを一切取得しておらず、「一般的な市場価格帯を参考に推定して
ください」とAIに尋ねていただけだった。返るのは実在しない推定価格で、それが
「各社見積価格」の比較表に入り、クライアントに出す見積の原価として使われていた。
画面に「推定値」の注意書きはあったが、表に4社並ぶと実際に取得した価格と
見分けがつかない。

代替:
- `api/fetch-price.js`（実際にページを取得して価格表を抽出する）
- 価格マスタ（実際に収集した価格を保存してある）

## 移植時のポイント

- **ランタイム**: Deno (`Deno.serve`) → Node (Vercel Functions のハンドラ)
- **認証**: `createClientFromRequest(req)` + `base44.auth.me()` → Supabase のアクセストークン検証
- **LLM**: `InvokeLLM`（`response_json_schema` で構造化出力）→ Claude API の tool use / structured output
- **APIキー**: 必ず Vercel の環境変数に置く。ブラウザには絶対に出さない
