// v2: Plan-Dateien werden nicht mehr direkt vom Backend ausgeliefert, sondern
// per Weiterleitung von Supabase Storage. Der Cache-Schluessel bleibt der
// stabile API-Pfad, der Umgang mit der Antwort musste aber angepasst werden
// (siehe cacheResponse). Der neue Name sorgt dafuer, dass alte Eintraege aus
// der Zeit des lokalen Servers verworfen werden.
const CACHE_NAME = 'poi-app-cache-v2'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

/**
 * Legt die Antwort im Cache ab, soweit das zulaessig ist.
 *
 * Zwei Faelle muessen abgefangen werden:
 *  - Teilantworten (206) entstehen, weil pdf.js den Plan stueckweise per
 *    Range-Anfrage liest. Die Cache-API lehnt sie ab.
 *  - Weitergeleitete Antworten (die Plan-Datei liegt jetzt hinter einer
 *    Weiterleitung auf Supabase Storage) werden vor dem Ablegen neu
 *    zusammengesetzt, damit der Eintrag ein gewoehnlicher 200er ist.
 */
async function cacheResponse(cache, request, response) {
  if (response.status === 206) return

  try {
    if (response.redirected) {
      const body = await response.clone().blob()
      await cache.put(
        request,
        new Response(body, {
          status: 200,
          statusText: 'OK',
          headers: response.headers,
        }),
      )
      return
    }
    await cache.put(request, response.clone())
  } catch {
    // Nicht cachebare Antwort - der Nutzer bekommt sie trotzdem, nur eben
    // ohne Offline-Kopie.
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  if (event.request.method !== 'GET') return
  // Fremde Adressen (Supabase Storage, Realtime, Auth) nicht anfassen - die
  // signierten URLs laufen ab und waeren als Cache-Eintrag wertlos.
  if (url.origin !== self.location.origin) return

  // API-Aufrufe ausser dem Plan-Datei-Endpunkt nicht cachen (immer live, ausser
  // explizit offline abgefangen im Client)
  const isPlanFile = /^\/api\/plans\/[^/]+\/file$/.test(url.pathname)
  if (url.pathname.startsWith('/api') && !isPlanFile) return

  // Netzwerk-first mit Cache-Fallback fuer Plan-Dateien und den App-Shell
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const response = await fetch(event.request)
        if (response.ok) {
          await cacheResponse(cache, event.request, response)
          return response
        }
        // Serverantwort kam an, war aber fehlerhaft (z.B. 404 waehrend eines
        // Backend-Neustarts) - vorherige gute Kopie aus dem Cache bevorzugen,
        // statt den Fehler an die UI durchzureichen.
        const cached = await cache.match(event.request)
        return cached ?? response
      } catch (err) {
        const cached = await cache.match(event.request)
        if (cached) return cached
        throw err
      }
    }),
  )
})
