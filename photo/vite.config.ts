/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Relative base so the same build works at any URL. GitHub Pages serves Lumen
// from /<repo>/photo/, next to Forge at /<repo>/.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Lumen – Photo Editor',
        short_name: 'Lumen',
        description: 'Private RAW photo editor for every camera: pro tools, 1,000 presets and an AI assistant.',
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#0F0F11',
        theme_color: '#0F0F11',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm}'],
        // The RAW decoder and JPEG encoder are WebAssembly; precache them so editing works offline.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  worker: { format: 'es' },
  // These packages load their own workers / .wasm files relative to import.meta.url.
  optimizeDeps: { exclude: ['libraw-wasm', '@jsquash/jpeg'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
