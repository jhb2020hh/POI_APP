import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const projektstamm = fileURLToPath(new URL('../..', import.meta.url))

const rootPackageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf-8')
)

/**
 * Der Commit, aus dem dieses Buendel gebaut wurde.
 *
 * Der Anlass ist konkret: eine gemeldete Unschaerfe liesz sich lange nicht
 * einordnen, weil nicht feststand, welcher Stand im Browser lief. Vercel
 * vergibt fuer jeden Commit eine eigene Preview-Adresse - eine gemerkte
 * aeltere zeigt dauerhaft alten Code. Die Versionsnummer aus der package.json
 * hilft dabei nicht, sie steht seit Langem auf 0.2.0, und zwei Buendel
 * desselben Tages sind am Datum ebenfalls nicht zu unterscheiden.
 *
 * Auf Vercel steht der Wert in der Umgebung; lokal wird git gefragt.
 */
function ermittleCommit(): string {
  const ausVercel = process.env.VERCEL_GIT_COMMIT_SHA
  if (ausVercel) return ausVercel.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return 'unbekannt'
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  /**
   * Woher die Supabase-Werte kommen, unterscheidet sich je nach Umgebung:
   *
   * - Lokal stehen sie in der .env im Projektstamm. Vite sucht .env-Dateien
   *   sonst nur in seinem eigenen Verzeichnis (packages/frontend) und legt sie
   *   ausserdem nicht in process.env ab - deshalb loadEnv mit ausdruecklichem
   *   Verzeichnis und leerem Praefix.
   * - Auf Vercel legt die Plattform sie direkt in die Umgebung. Die hat
   *   Vorrang, damit dort nichts von einer versehentlich mitgelieferten Datei
   *   ueberschrieben wird.
   *
   * Die Supabase-Integration in Vercel vergibt die Namen zudem ohne
   * VITE_-Praefix, den Vite braucht - deshalb die Ersatznamen.
   *
   * Bewusst nur URL und anon/publishable key: die einzigen beiden Werte, die
   * oeffentlich sein duerfen. SUPABASE_SECRET_KEY und
   * SUPABASE_SERVICE_ROLE_KEY duerfen niemals ins Bundle gelangen.
   */
  const env = { ...loadEnv(mode, projektstamm, ''), ...process.env }

  const supabaseUrl =
    env.VITE_SUPABASE_URL ||
    env.SUPABASE_URL ||
    env.NEXT_PUBLIC_SUPABASE_URL ||
    ''

  const supabaseAnonKey =
    env.VITE_SUPABASE_ANON_KEY ||
    env.SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    env.SUPABASE_PUBLISHABLE_KEY ||
    ''

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
      '[vite] Supabase-URL oder anon-Key fehlt. Die App startet, meldet beim ' +
        'Anmelden aber, dass sie nicht konfiguriert ist.',
    )
  }

  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(rootPackageJson.version),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
      __BUILD_COMMIT__: JSON.stringify(ermittleCommit()),
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
  }
})
