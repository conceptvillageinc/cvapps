// dom-to-svg（MIT）を、サーバーのブラウザに読み込める 1 つのファイルにまとめる。
//   出力: api/_lib/vendor/dom-to-svg.iife.js（window.CVDomToSvg に documentToSVG・elementToSVG・inlineResources）
//   dom-to-svg の版を上げたら、もう一度実行して出力をコミットする: node scripts/build-dom-to-svg.mjs
import { build } from 'esbuild';

await build({
  stdin: { contents: "export { documentToSVG, elementToSVG, inlineResources } from 'dom-to-svg';", resolveDir: process.cwd(), loader: 'js' },
  bundle: true,
  format: 'iife',
  globalName: 'CVDomToSvg',
  platform: 'browser',
  target: 'chrome110',
  minify: true,
  legalComments: 'inline',
  outfile: 'api/_lib/vendor/dom-to-svg.iife.js',
  banner: { js: '/* dom-to-svg 0.12.2 (MIT License, https://github.com/felixfbecker/dom-to-svg) と依存（postcss・postcss-value-parser・gradient-parser、MIT）を 1 つにまとめたもの。scripts/build-dom-to-svg.mjs で作る */' },
});
console.log('ok');
