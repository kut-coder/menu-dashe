import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Моё меню от Нутриксю',
        short_name: 'Моё меню',
        description: 'Удобное чтение меню и список покупок',
        theme_color: '#e8f5c8',
        background_color: '#f3f8e8',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait',
        start_url: process.env.VITE_BASE || '/',
        scope: process.env.VITE_BASE || '/',
        lang: 'ru',
        prefer_related_applications: false,
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
        globIgnores: ['**/icon-source.*', '**/menu-week1-source.*'],
      },
    }),
  ],
})
