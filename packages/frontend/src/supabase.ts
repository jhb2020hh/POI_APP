import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL ?? ''
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

/**
 * Wird zur Bauzeit ausgewertet: Vite ersetzt import.meta.env.VITE_* durch die
 * konkreten Werte, fehlende Variablen werden zu undefined.
 */
export const isSupabaseConfigured = Boolean(url && anonKey)

if (!isSupabaseConfigured) {
  // Bewusst kein `throw` auf Modulebene: die Bedingung ist nach dem Ersetzen
  // der Variablen eine Konstante, und ein unbedingter Wurf hier macht fuer den
  // Bundler den gesamten nachfolgenden Anwendungscode unerreichbar - er fliegt
  // dann kommentarlos aus dem Bundle. Der Build meldet trotzdem Erfolg und man
  // haette eine leere Seite ausgeliefert. Stattdessen wird die App gebaut und
  // meldet den fehlenden Wert erst beim Anmeldeversuch.
  console.error(
    'VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY sind nicht gesetzt - siehe .env.example.',
  )
}

/**
 * Der anon-Key ist oeffentlich und darf im Bundle stehen. Er allein gewaehrt
 * keinen Datenzugriff: alle Tabellen haben Row Level Security aktiv (siehe
 * Migration 0020), und die Anwendungsdaten laufen ohnehin ueber die eigene API.
 * Dieser Client wird nur fuer Anmeldung, Datei-Upload und Live-Updates genutzt.
 *
 * Die Platzhalter greifen nur, wenn nichts konfiguriert ist - createClient
 * verlangt syntaktisch gueltige Werte. Jeder Aufruf schlaegt dann fehl, was
 * ueber isSupabaseConfigured vorher abgefangen wird.
 */
export const supabase = createClient(
  url || 'https://nicht-konfiguriert.supabase.co',
  anonKey || 'nicht-konfiguriert',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  },
)
