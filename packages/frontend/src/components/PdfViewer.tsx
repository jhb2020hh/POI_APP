import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import type { Category, Point } from '@poi-app/shared'
import { getToken } from '../api/client'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

const FALLBACK_COLOR = '#888888'
const FALLBACK_GLYPH = '!'
/** Startwert, bis der Einpassmaszstab feststeht. */
const DEFAULT_SCALE = 1.5

/**
 * Absoluter Boden - greift nur, wenn sich der Einpassmaszstab nicht ermitteln
 * laesst (Zeichenflaeche noch ohne Masze). Die eigentliche Untergrenze ist der
 * Maszstab, bei dem die ganze Seite sichtbar ist; kleiner braucht es nie.
 *
 * Vorher stand hier eine feste Untergrenze von 0,75. Die zog *jeden* Wert hoch,
 * auch das Einpassen: ein A3-Plan (rund 1190 pt breit) braucht auf einem
 * 360-px-Bildschirm etwa 0,28 und wurde damit fast dreimal zu grosz gezeichnet -
 * ringsum abgeschnitten. Und weil die Anzeige gegen DEFAULT_SCALE rechnete, war
 * bei 0,75 genau bei den gemeldeten 50 % Schluss. Ein Fehler, zwei Symptome.
 */
const MIN_SCALE_ABSOLUT = 0.05
const MAX_SCALE = 4.5

/**
 * Zoomschritte sind multiplikativ, nicht additiv. Ein fester Summand von 0,375
 * waere bei Einpassmaszstab 0,28 mehr als eine Verdopplung - der erste Schritt
 * haette den halben Plan aus dem Bild geschoben.
 */
const ZOOM_FAKTOR = 1.25
/** Feiner, weil ein Mausradtick viel oefter kommt als ein Tastendruck. */
const RAD_FAKTOR = 1.08

// plan und users wurden nur fuer den hier entfernten Export gebraucht.
interface PdfViewerProps {
  fileUrl: string
  points: Point[]
  categories: Category[]
  selectedPointId?: string
  onCanvasClick: (relX: number, relY: number) => void
  onPointClick: (point: Point) => void
}

export function PdfViewer({
  fileUrl,
  points,
  categories,
  selectedPointId,
  onCanvasClick,
  onPointClick,
}: PdfViewerProps) {
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)
  const renderDebounceRef = useRef<number | null>(null)
  /** Maszstab, in dem die Zeichnung aktuell im Canvas steht. */
  const gerendertRef = useRef<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [scale, setScale] = useState(DEFAULT_SCALE)
  const [retryCount, setRetryCount] = useState(0)
  /**
   * Maszstab, bei dem die ganze Seite in die Zeichenflaeche passt - zugleich
   * Untergrenze und Bezugsgroesze der Prozentanzeige (100 % = alles sichtbar).
   *
   * Doppelt gefuehrt: der State loest das Neuzeichnen der Leiste aus, der Ref
   * wird in den Zeigerhandlern und im Begrenzer gelesen, die sonst mit einem
   * veralteten Wert aus ihrer Closure rechnen wuerden.
   */
  const [einpassMassstab, setEinpassMassstab] = useState<number | null>(null)
  const einpassRef = useRef<number | null>(null)

  const renderAtScale = useCallback(async (targetScale: number) => {
    const pdf = pdfDocRef.current
    const canvas = canvasRef.current
    if (!pdf || !canvas) return

    renderTaskRef.current?.cancel()

    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: targetScale })
    const context = canvas.getContext('2d')
    if (!context) return

    canvas.width = viewport.width
    canvas.height = viewport.height

    const task = page.render({ canvasContext: context, viewport, canvas })
    renderTaskRef.current = task
    try {
      await task.promise
      gerendertRef.current = targetScale
      setSize({ width: viewport.width, height: viewport.height })
    } catch (err) {
      if ((err as { name?: string })?.name !== 'RenderingCancelledException') throw err
    } finally {
      if (renderTaskRef.current === task) renderTaskRef.current = null
    }
  }, [])

  /** Kleinster zugelassener Maszstab: die eingepasste Seite. */
  function untergrenze(): number {
    return Math.max(MIN_SCALE_ABSOLUT, einpassRef.current ?? MIN_SCALE_ABSOLUT)
  }

  /**
   * Groeszter zugelassener Maszstab.
   *
   * Nicht stur MAX_SCALE: passt eine kleine Seite in einem groszen Fenster erst
   * bei Maszstab 5 ein, waere die Obergrenze sonst kleiner als die Untergrenze
   * und man koennte gar nichts mehr einstellen.
   */
  function obergrenze(): number {
    return Math.max(MAX_SCALE, untergrenze())
  }

  function begrenzeMassstab(wert: number): number {
    return Math.min(obergrenze(), Math.max(untergrenze(), Math.round(wert * 1000) / 1000))
  }

  function zoomUm(faktor: number) {
    setScale((s) => begrenzeMassstab(s * faktor))
  }

  /** Der scrollende Kasten um die Zeichnung - er traegt das Schwenken. */
  function scrollflaeche(): HTMLElement | null {
    return cardRef.current?.closest('.plan-canvas-area') as HTMLElement | null
  }

  /**
   * Ermittelt den Maszstab, bei dem die *ganze* Seite in die Zeichenflaeche
   * passt, und merkt ihn als Untergrenze und Bezugsgroesze vor.
   *
   * Frueher wurde nur die Breite betrachtet. Bei einem Hochformat-Plan blieb
   * damit unten trotzdem etwas abgeschnitten - massgeblich ist der kleinere der
   * beiden Faktoren. Ist die Hoehe noch nicht bekannt (Zeichenflaeche gerade
   * erst im Aufbau), zaehlt ersatzweise die Breite allein.
   */
  const berechneEinpassMassstab = useCallback(async (): Promise<number | null> => {
    const pdf = pdfDocRef.current
    const flaeche = scrollflaeche()
    if (!pdf || !flaeche) return null

    const seite = await pdf.getPage(1)
    const grund = seite.getViewport({ scale: 1 })
    // 24 px Luft, damit der Plan nicht bündig am Rand klebt.
    const breite = flaeche.clientWidth - 24
    const hoehe = flaeche.clientHeight - 24
    if (breite <= 0 || grund.width <= 0 || grund.height <= 0) return null

    const nachBreite = breite / grund.width
    const faktor = hoehe > 0 ? Math.min(nachBreite, hoehe / grund.height) : nachBreite
    const gerundet = Math.max(MIN_SCALE_ABSOLUT, Math.round(faktor * 1000) / 1000)

    einpassRef.current = gerundet
    setEinpassMassstab(gerundet)
    return gerundet
  }, [])

  /** Zurueck auf "ganze Seite sichtbar". */
  const passeSeiteEin = useCallback(async () => {
    const ziel = await berechneEinpassMassstab()
    if (ziel === null) return
    setScale(ziel)
  }, [berechneEinpassMassstab])

  /**
   * Haelt den Einpassmaszstab nach, wenn sich die Zeichenflaeche aendert.
   *
   * Noetig, seit sich die Seitenleisten einklappen lassen: der Einpassmaszstab
   * ist zugleich die Untergrenze des Zooms. Ohne Nachrechnen bliebe nach dem
   * Einklappen die alte, zu kleine Untergrenze stehen, und die Prozentanzeige
   * behauptete "100 %" fuer eine Seite, die den Platz gar nicht mehr ausfuellt.
   *
   * Wer die ganze Seite sieht, sieht sie danach weiter; wer hineingezoomt hat,
   * behaelt seine Vergroesserung - nur die Grenzen wandern mit.
   */
  useEffect(() => {
    const flaeche = scrollflaeche()
    if (!flaeche || typeof ResizeObserver === 'undefined') return

    let zeitgeber: number | null = null
    const beobachter = new ResizeObserver(() => {
      // Entprellt, weil das Ein- und Ausklappen als Uebergang laeuft und dabei
      // fortlaufend neue Breiten meldet.
      if (zeitgeber) window.clearTimeout(zeitgeber)
      zeitgeber = window.setTimeout(async () => {
        const vorher = einpassRef.current
        const neu = await berechneEinpassMassstab()
        if (neu === null) return
        setScale((s) =>
          vorher !== null && Math.abs(s - vorher) < 0.001 ? neu : begrenzeMassstab(s)
        )
      }, 150)
    })

    beobachter.observe(flaeche)
    return () => {
      if (zeitgeber) window.clearTimeout(zeitgeber)
      beobachter.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [berechneEinpassMassstab])

  useEffect(() => {
    let cancelled = false
    setScale(DEFAULT_SCALE)
    setEinpassMassstab(null)
    einpassRef.current = null
    setError(null)

    async function load() {
      try {
        const token = getToken()
        const loadingTask = pdfjsLib.getDocument({
          url: fileUrl,
          httpHeaders: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        const pdf = await loadingTask.promise
        if (cancelled) return
        pdfDocRef.current = pdf

        // Erst den Einpassmaszstab bestimmen, dann *einmal* zeichnen. Vorher
        // wurde zuerst in DEFAULT_SCALE gerendert und gleich darauf noch einmal
        // in der Einpassgroesze - sichtbar als Sprung und eine vergebene
        // pdf.js-Rendierung.
        const ziel = (await berechneEinpassMassstab()) ?? DEFAULT_SCALE
        if (cancelled) return
        await renderAtScale(ziel)
        if (cancelled) return
        setScale(ziel)
      } catch (err) {
        if (!cancelled) setError(String(err))
      }
    }

    load()
    return () => {
      cancelled = true
      pdfDocRef.current = null
    }
  }, [fileUrl, renderAtScale, berechneEinpassMassstab, retryCount])

  useEffect(() => {
    // Verglichen wird mit dem tatsaechlich gezeichneten Maszstab. Die fruehere
    // Bedingung "ungleich DEFAULT_SCALE" liess das Zuruecksetzen ins Leere
    // laufen: der Zielwert war genau DEFAULT_SCALE, also wurde nie neu
    // gezeichnet und die Zeichnung blieb in der alten Vergroesserung stehen.
    if (!pdfDocRef.current || gerendertRef.current === scale) return
    // Entprellt: schnelle Strg+Mausrad-Ticks loesen sonst bei jedem einzelnen
    // Schritt ein volles pdf.js-Rerendering aus.
    if (renderDebounceRef.current) window.clearTimeout(renderDebounceRef.current)
    renderDebounceRef.current = window.setTimeout(() => {
      renderAtScale(scale)
    }, 120)
    return () => {
      if (renderDebounceRef.current) window.clearTimeout(renderDebounceRef.current)
    }
  }, [scale, renderAtScale])


  // Strg+Mausrad zoomt (wie Google Maps/Figma); normales Rad scrollt weiterhin
  // die umgebende .plan-canvas-area, damit das Schwenken groesser, reingezoomter
  // Plaene per Mausrad nicht verloren geht.
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    function handleWheel(e: WheelEvent) {
      if (!e.ctrlKey) return
      e.preventDefault()
      zoomUm(e.deltaY > 0 ? 1 / RAD_FAKTOR : RAD_FAKTOR)
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Der Export lag hier frueher ein zweites Mal - mit identischem Ergebnis, aber
  // ohne Fehlerrueckmeldung: Rueckgabewert und Ausnahmen wurden verworfen.
  // Saemtliche Ausgaben laufen jetzt ueber den Export-Bereich in der Baumleiste.

  /* ------------------------------------------------------------------------
     Zeigerbedienung: Schwenken, Zwei-Finger-Zoom, Tippen
     ------------------------------------------------------------------------
     Frueher lag hier ein reines onClick. Auf einem Touchgeraet endet aber jede
     Wischbewegung als Klick - jeder Schwenkversuch legte damit ein neues Ticket
     an. Deshalb wird jetzt unterschieden: als Tippen gilt nur, was sich kaum
     bewegt hat und kurz war.
  */

  const zeigerRef = useRef(new Map<number, { x: number; y: number }>())
  const gesteRef = useRef<{ startAbstand: number; startMassstab: number } | null>(null)
  const tippRef = useRef<{ x: number; y: number; zeit: number; verschoben: boolean } | null>(null)
  const schwenkRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)

  // Ab dieser Bewegung gilt es als Schwenken und nicht mehr als Tippen.
  const TIPP_TOLERANZ_PX = 10
  const TIPP_HOECHSTDAUER_MS = 600

  function abstandTasten(): number {
    const [a, b] = [...zeigerRef.current.values()]
    if (!a || !b) return 0
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    zeigerRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (zeigerRef.current.size === 2) {
      // Zweiter Finger: aus Schwenken wird Zoomen, und aus dem Tippen nichts.
      gesteRef.current = { startAbstand: abstandTasten(), startMassstab: scale }
      tippRef.current = null
      schwenkRef.current = null
      return
    }

    if (zeigerRef.current.size === 1) {
      const flaeche = scrollflaeche()
      tippRef.current = { x: e.clientX, y: e.clientY, zeit: Date.now(), verschoben: false }
      schwenkRef.current = flaeche
        ? { x: e.clientX, y: e.clientY, left: flaeche.scrollLeft, top: flaeche.scrollTop }
        : null
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!zeigerRef.current.has(e.pointerId)) return
    zeigerRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // Zwei Finger: Maszstab am Verhaeltnis der Fingerabstaende.
    if (zeigerRef.current.size === 2 && gesteRef.current) {
      const jetzt = abstandTasten()
      if (gesteRef.current.startAbstand > 0 && jetzt > 0) {
        setScale(begrenzeMassstab(gesteRef.current.startMassstab * (jetzt / gesteRef.current.startAbstand)))
      }
      return
    }

    const start = tippRef.current
    if (!start) return

    const bewegung = Math.hypot(e.clientX - start.x, e.clientY - start.y)
    if (bewegung > TIPP_TOLERANZ_PX) start.verschoben = true

    // Schwenken nur mit dem Finger oder Stift. Mit der Maus bleibt das
    // gewohnte Verhalten: ziehen markiert, gescrollt wird mit dem Rad.
    const schwenk = schwenkRef.current
    const flaeche = scrollflaeche()
    if (e.pointerType !== 'mouse' && schwenk && flaeche && start.verschoben) {
      flaeche.scrollLeft = schwenk.left - (e.clientX - schwenk.x)
      flaeche.scrollTop = schwenk.top - (e.clientY - schwenk.y)
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const start = tippRef.current
    zeigerRef.current.delete(e.pointerId)
    if (zeigerRef.current.size < 2) gesteRef.current = null
    if (zeigerRef.current.size === 0) schwenkRef.current = null

    if (!start) return
    tippRef.current = null

    // Pins haben eine eigene Behandlung.
    const ziel = e.target as HTMLElement
    if (ziel.dataset.pinMarker) return

    const dauer = Date.now() - start.zeit
    if (start.verschoben || dauer > TIPP_HOECHSTDAUER_MS) return

    const rect = e.currentTarget.getBoundingClientRect()
    onCanvasClick((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    zeigerRef.current.delete(e.pointerId)
    gesteRef.current = null
    tippRef.current = null
    schwenkRef.current = null
  }

  if (error) {
    return (
      <div>
        <p style={{ color: 'var(--color-danger)' }}>PDF konnte nicht geladen werden: {error}</p>
        <button type="button" className="icon-btn" onClick={() => setRetryCount((c) => c + 1)}>
          Erneut versuchen
        </button>
      </div>
    )
  }

  return (
    <>
    <div
      ref={cardRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      className="card"
      style={{
        position: 'relative',
        display: 'inline-block',
        flexShrink: 0,
        width: size?.width,
        height: size?.height,
        cursor: 'crosshair',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-sm)',
        // Der Browser soll Wisch- und Zwei-Finger-Gesten nicht selbst
        // auswerten - sonst zoomt er die ganze Seite, waehrend wir den Plan
        // schwenken wollen.
        touchAction: 'none',
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      {points.map((point) => {
        const category = point.category_id ? categoryById.get(point.category_id) : undefined
        const color = category?.color ?? FALLBACK_COLOR
        const glyph = category?.glyph ?? FALLBACK_GLYPH
        const isSelected = point.id === selectedPointId
        return (
          <button
            key={point.id}
            data-pin-marker="true"
            onClick={(e) => {
              e.stopPropagation()
              onPointClick(point)
            }}
            title={`${point.ticket_number ? `${point.ticket_number} – ` : ''}${point.title}${category ? ` (${category.name})` : ''}`}
            style={{
              position: 'absolute',
              left: `${point.x * 100}%`,
              top: `${point.y * 100}%`,
              transform: isSelected ? 'translate(-50%, -100%) scale(1.25)' : 'translate(-50%, -100%)',
              transformOrigin: 'bottom center',
              background: color,
              color: '#fff',
              border: isSelected ? '2px solid #1a73e8' : '2px solid #fff',
              boxShadow: isSelected
                ? '0 0 0 3px rgba(26, 115, 232, 0.45), 0 1px 4px rgba(0,0,0,0.35)'
                : '0 1px 4px rgba(0,0,0,0.35)',
              borderRadius: '50% 50% 50% 0',
              width: 26,
              height: 26,
              padding: 0,
              cursor: 'pointer',
              lineHeight: '22px',
              fontSize: 12,
              fontWeight: 700,
              zIndex: isSelected ? 1 : 0,
              transition: 'transform 0.12s ease, box-shadow 0.12s ease',
            }}
          >
            {glyph}
          </button>
        )
      })}
    </div>
      {/* Positionierung steckt in App.css: auf schmalen Bildschirmen sitzt die
          Leiste unten am Bildschirmrand statt oben ueber der Zeichnung - dort
          verdeckte sie einen Grossteil des sichtbaren Bereichs und scrollte
          beim Schwenken aus dem Bild. */}
      <div className="pdf-zoom-toolbar" onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="icon-btn"
          onClick={() => zoomUm(1 / ZOOM_FAKTOR)}
          disabled={scale <= untergrenze()}
          title="Verkleinern"
        >
          −
        </button>
        {/* Bezugsgroesze ist die eingepasste Seite: 100 % heiszt "alles
            sichtbar". Gegen DEFAULT_SCALE zu rechnen ergab je nach Planformat
            voellig verschiedene Zahlen fuer denselben Anblick. */}
        <span style={{ fontSize: 12, minWidth: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
          {Math.round((scale / (einpassMassstab ?? DEFAULT_SCALE)) * 100)}%
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => zoomUm(ZOOM_FAKTOR)}
          disabled={scale >= obergrenze()}
          title="Vergrößern"
        >
          +
        </button>
        {/* Zuruecksetzen heisst "ganze Seite einpassen" - der Zustand, in dem
            der Plan geoeffnet wird, und auf schmalen Bildschirmen der einzige,
            in dem man ihn vollstaendig sieht. */}
        <button
          type="button"
          className="icon-btn"
          onClick={() => void passeSeiteEin()}
          title="Ganze Seite einpassen"
        >
          ⟲
        </button>
      </div>
    </>
  )
}
