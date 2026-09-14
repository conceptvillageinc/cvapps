import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// ビルドされたコミット。Vercel がビルド時に渡す環境変数から取る。
// 「直したはずの変更が画面に出ない」ときに、ブラウザが見ているのが
// どのビルドなのかを一目で判別するために画面へ出す。
const buildId = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'dev'

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [react()],
  resolve: {
    // 「@/」→「src/」のエイリアス。
    // 以前は @base44/vite-plugin が提供していたため設定ファイル上に存在しなかった。
    // Base44 依存を外すにあたり、ここで明示的に定義する。
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
