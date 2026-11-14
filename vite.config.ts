import { defineConfig } from 'vite'
export default defineConfig({
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  server: { port: 5173 },
  preview: { port: 4173 }
})
