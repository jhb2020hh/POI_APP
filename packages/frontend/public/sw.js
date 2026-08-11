const CACHE_NAME = 'poi-app-cache-v1'

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.pathname.startsWith('/ws')) {
    return
  }
  // API-Aufrufe ausser dem PDF-Datei-Endpunkt nicht cachen (immer live, ausser explizit offline abgefangen im Client)
  const isPlanFile = /^\/api\/plans\/[^/]+\/file$/.test(url.pathname)
  if (url.pathname.startsWith('/api') && !isPlanFile) {
    return
  }

  // Netzwerk-first mit Cache-Fallback fuer PDF-Dateien und den App-Shell (statische Assets, Navigation)
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const response = await fetch(event.request)
        if (response.ok) {
          cache.put(event.request, response.clone())
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
    })
  )
})
