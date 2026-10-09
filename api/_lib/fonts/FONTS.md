# 帳票 PDF のフォント

- `NotoSansJP-400.ttf` / `NotoSansJP-700.ttf` … 本文（日本語）。Noto Sans JP（SIL Open Font License 1.1）
- `NotoSans-400.ttf` / `NotoSans-700.ttf` … 日本語フォントに無いギリシャ文字（α β μ Ω など）の代わり。Noto Sans（SIL Open Font License 1.1）
- `DejaVuSans.ttf` / `DejaVuSans-Bold.ttf` … それでも無い文字（Ⅰ Ⅱ のローマ数字、≒ ✔ などの記号）の代わり。DejaVu Fonts（Bitstream Vera / Arev フォントのライセンス。改変しなければ自由に再配布できる）

代わりのフォントへの切り替えは `api/_lib/docLayout.js` の `registerFonts`（`installFallback`）で行う。
