import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootPackageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf-8')
)

/**
 * Die Supabase-Integration in Vercel legt ihre Variablen ohne VITE_-Praefix an,
 * Vite reicht aber nur VITE_*-Werte ins Bundle. Statt jede Variable im
 * Vercel-Dashboard ein zweites Mal zu pflegen, werden die oeffentlichen Werte
 * hier aus den Namen der Integration uebernommen.
 *
 * Bewusst nur URL und anon/publishable key: das sind die einzigen beiden Werte,
 * die oeffentlich sein duerfen. SUPABASE_SECRET_KEY und
 * SUPABASE_SERVICE_ROLE_KEY duerfen niemals ins Bundle gelangen.
 */
const supabaseUrl =
  process.env.VITE_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  ''

const supabaseAnonKey =
  process.env.VITE_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  ''

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[build] Supabase-URL oder anon-Key fehlt. Die App wird gebaut, meldet beim ' +
      'Anmelden aber, dass sie nicht konfiguriert ist.',
  )
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPackageJson.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
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
