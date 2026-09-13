import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
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
