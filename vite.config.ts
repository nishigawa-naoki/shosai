import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 新しい版は利用者が「更新」を押したときに切り替える（UpdateBanner）。登録もそこで行う
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg'],
      manifest: {
        name: '執筆帳',
        short_name: '執筆帳',
        description: '自分用の執筆ツール',
        lang: 'ja',
        start_url: '/',
        display: 'standalone',
        background_color: '#f3f0e9',
        theme_color: '#f3f0e9',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        navigateFallback: '/index.html',
        // Firebase の予約パス（ログイン処理 /__/auth/handler など）は横取りしない
        navigateFallbackDenylist: [/^\/__\//],
        globPatterns: ['**/*.{js,css,html,svg}'],
      },
    }),
  ],
})
