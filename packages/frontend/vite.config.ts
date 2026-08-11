import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootPackageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf-8')
)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPackageJson.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  // Nur noch /api wird weitergereicht. Der fruehere /ws-Proxy entfaellt:
  // Live-Updates laufen jetzt direkt gegen Supabase Realtime und damit nicht
  // mehr ueber den eigenen Server.
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  preview: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
