import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Renderer-only production build for GUI smoke tests. Exposes the __mep test hook
// (VITE_MEP_E2E=1); the real electron-vite build never defines it.
export default defineConfig({
  root: resolve(__dirname, '../src/renderer'),
  base: './',
  resolve: { alias: { '@renderer': resolve(__dirname, '../src/renderer/src') } },
  plugins: [react(), tailwindcss()],
  define: { 'import.meta.env.VITE_MEP_E2E': '"1"' },
  build: { outDir: resolve(__dirname, '../out-e2e/renderer'), emptyOutDir: true },
  preview: { port: 4319, strictPort: true, host: '127.0.0.1' }
})
