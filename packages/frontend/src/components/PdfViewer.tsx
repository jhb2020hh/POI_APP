import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import type { Category, Point } from '@poi-app/shared'
import { getToken } from '../api/client'
import { Zeichen } from './Zeichen'
import {
  ANSICHT_START,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STUFE,
  begrenzeVerschiebung,
  berechneEinpassung,
  berechneZeichenMassstab,
  radZuFaktor,
  zoomeAufPunkt,
  type Ansicht,
  type Masze,
} from '../utils/planAnsicht'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

const FALLBACK_COLOR = '#888888'
const FALLBACK_GLYPH = '!'

/**
 * Ab dieser Bewegung gilt es als Schwenken und nicht mehr als Tippen. Auf einem
 * Touchgeraet endet jede Wischbewegung als Klick - ohne die Schwelle legte
 * jeder Schwenkversuch ein neues Ticket an.
 */
const TIPP_TOLERANZ_PX = 10
const TIPP_HOECHSTDAUER_MS = 600

/** Ruhe nach der Geste, bevor pdf.js scharf nachzeichnet. */
const NACHSCHAERFEN_MS = 150

/**
 * Die Planansicht.
 *
 * Der tragende Gedanke: Sehen und Zeichnen sind getrennt.
 *
 *   .plan-flaeche   der sichtbare Ausschnitt, faengt alle Eingaben ab
 *     .plan-buehne  feste CSS-Groesze (Seite im Einpassmaszstab),
 *                   bewegt wird sie ueber transform - sofort und ohne Umbruch
 *       <canvas>    dieselbe CSS-Groesze, aber ein Bitmap in der Aufloesung,
 *                   die der aktuelle Zoom braucht
 *       Pins        weiterhin in Prozent, wachsen aber nicht mit
 *
 * Vorher lag beides auf einer Groesze: `scale` bestimmte zugleich den Anblick
 * und die Aufloesung des Canvas. Jede Bewegung hing damit am Neuzeichnen, das
 * Layout aenderte sich dabei, und der Ausschnitt sprang. Jetzt aendert das
 * Nachschaerfen nur noch das Bitmap - sichtbar bewegt sich dabei nichts.
 */
interface PdfViewerProps {
  fileUrl: string
  points: Point[]
  categories: Category[]
  selectedPointId?: string
  onCanvasClick: (relX: number, relY: number) => void
  onPointClick: (point: Point) => void
  /** Nur fuer den Hinweis: der Betrachter zeigt immer Seite 1. */
  seitenzahl?: number | null
}

export function PdfViewer({
  fileUrl,
  points,
  categories,
  selectedPointId,
  onCanvasClick,
  onPointClick,
  seitenzahl,
}: PdfViewerProps) {
  const categoryById = new Map(categories.map((c) => [c.id, c]))

  const flaecheRef = useRef<HTMLDivElement>(null)
  const buehneRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)
  /** Nur zum Freigeben - `destroy` haengt am Ladeauftrag, nicht am Dokument. */
  const ladeAuftragRef = useRef<PDFDocumentLoadingTask | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [neuVersuch, setNeuVersuch] = useState(0)
  /** Seitengroesze in PDF-Punkten (Maszstab 1). */
  const [seite, setSeite] = useState<Masze | null>(null)
  /** Bildschirmpunkte je PDF-Punkt, wenn die ganze Seite sichtbar ist. */
  const [einpass, setEinpass] = useState<number | null>(null)
  const [ansicht, setAnsicht] = useState<Ansicht>(ANSICHT_START)

  /**
   * Seitengroesze und Einpassmaszstab zusaetzlich als Ref.
   *
   * Der ResizeObserver und die Zeigerbehandlung werden genau einmal gesetzt.
   * Ohne Ref rechneten sie mit dem Stand aus ihrer Closure - beim Zoomen also
   * fortlaufend mit dem Ausgangswert. Die Ansicht selbst braucht das nicht:
   * jede Aenderung laeuft ueber die Funktionsform von setzeAnsicht und bekommt
   * den aktuellen Stand von React.
   */
  const einpassRef = useRef<number | null>(null)
  const seiteRef = useRef<Masze | null>(null)

  function flaechenMasze(): Masze | null {
    const el = flaecheRef.current
    if (!el) return null
    return { breite: el.clientWidth, hoehe: el.clientHeight }
  }

  /** Seitengroesze in Bildschirmpunkten bei Zoom 1. */
  function buehnenMasze(): Masze | null {
    const s = seiteRef.current
    const e = einpassRef.current
    if (!s || !e) return null
    return { breite: s.breite * e, hoehe: s.hoehe * e }
  }

  /**
   * Einzige Stelle, an der sich die Ansicht aendert - und damit die einzige,
   * die die Grenzen kennen muss. Verteilte Einzelpruefungen waeren genau die
   * Stelle, an der spaeter eine vergessen wird.
   */
  const setzeAnsicht = useCallback((naechste: Ansicht | ((vorher: Ansicht) => Ansicht)) => {
    setAnsicht((vorher) => {
      const roh = typeof naechste === 'function' ? naechste(vorher) : naechste
      const buehne = buehnenMasze()
      const flaeche = flaechenMasze()
      return buehne && flaeche ? begrenzeVerschiebung(roh, buehne, flaeche) : roh
    })
  }, [])

  /* ---------------------------------------------------------------------
     Zeichnen
     --------------------------------------------------------------------- */

  /** Maszstab, in dem das Bitmap zuletzt entstanden ist. */
  const gezeichnetRef = useRef<number | null>(null)
  const schaerfenRef = useRef<number | null>(null)

  const zeichne = useCallback(async (zeichenMassstab: number) => {
    const pdf = pdfDocRef.current
    const canvas = canvasRef.current
    if (!pdf || !canvas) return

    renderTaskRef.current?.cancel()

    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: zeichenMassstab })
    const context = canvas.getContext('2d')
    if (!context) return

    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)

    const task = page.render({ canvasContext: context, viewport, canvas })
    renderTaskRef.current = task
    try {
      await task.promise
      gezeichnetRef.current = zeichenMassstab
    } catch (err) {
      if ((err as { name?: string })?.name !== 'RenderingCancelledException') throw err
    } finally {
      if (renderTaskRef.current === task) renderTaskRef.current = null
    }
  }, [])

  /**
   * Schaerft nach, sobald die Geste steht.
   *
   * Bis dahin skaliert der Browser das vorhandene Bitmap - man sieht also
   * sofort etwas, es wird nur kurz weich. Vorher aenderte sich waehrend der
   * Wartezeit gar nichts und dann alles auf einmal.
   */
  useEffect(() => {
    if (!seite || !einpass) return
    const dichte = window.devicePixelRatio || 1
    const ziel = berechneZeichenMassstab(seite, einpass, ansicht.zoom, dichte)
    if (gezeichnetRef.current !== null && Math.abs(gezeichnetRef.current - ziel) < 0.0005) return

    // Beim ersten Bild sofort - sonst saehe man beim Oeffnen eines Plans
    // erst einmal eine leere Flaeche. Gewartet wird nur beim Nachschaerfen,
    // wo ja bereits ein Bild steht.
    if (gezeichnetRef.current === null) {
      void zeichne(ziel)
      return
    }

    if (schaerfenRef.current) window.clearTimeout(schaerfenRef.current)
    schaerfenRef.current = window.setTimeout(() => {
      void zeichne(ziel)
    }, NACHSCHAERFEN_MS)

    return () => {
      if (schaerfenRef.current) window.clearTimeout(schaerfenRef.current)
    }
  }, [seite, einpass, ansicht.zoom, zeichne])

  /* ---------------------------------------------------------------------
     Laden
     --------------------------------------------------------------------- */

  useEffect(() => {
    let abgebrochen = false
    setError(null)
    setSeite(null)
    setEinpass(null)
    seiteRef.current = null
    einpassRef.current = null
    gezeichnetRef.current = null
    setAnsicht(ANSICHT_START)

    async function lade() {
      try {
        const token = getToken()
        const auftrag = pdfjsLib.getDocument({
          url: fileUrl,
          httpHeaders: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        ladeAuftragRef.current = auftrag
        const pdf = await auftrag.promise
        if (abgebrochen) return
        pdfDocRef.current = pdf

        const ersteSeite = await pdf.getPage(1)
        const grund = ersteSeite.getViewport({ scale: 1 })
        const masze: Masze = { breite: grund.width, hoehe: grund.height }
        const flaeche = flaechenMasze()
        const eingepasst = flaeche ? berechneEinpassung(masze, flaeche) : null
        if (abgebrochen) return

        seiteRef.current = masze
        einpassRef.current = eingepasst
        setSeite(masze)
        setEinpass(eingepasst)
        // Gezeichnet wird nicht hier, sondern in dem Effekt darueber - er ist
        // die einzige Stelle, die den Zeichenmaszstab bestimmt. Von hier aus
        // zusaetzlich zu zeichnen ergab dasselbe Bild ein zweites Mal.
        // Ohne bekannte Flaeche wartet auch der: der ResizeObserver holt es
        // nach, sobald sie Masze hat.
        if (eingepasst === null) return
        setzeAnsicht(ANSICHT_START)
      } catch (err) {
        if (!abgebrochen) setError(String(err))
      }
    }

    void lade()
    return () => {
      abgebrochen = true
      // Erst abbrechen, dann freigeben: `destroy` waehrend einer laufenden
      // Zeichnung bricht mit einer Ausnahme ab. Ohne das Freigeben bleibt bei
      // jedem Planwechsel ein Dokument samt Arbeiter im Speicher zurueck.
      renderTaskRef.current?.cancel()
      renderTaskRef.current = null
      pdfDocRef.current = null
      const auftrag = ladeAuftragRef.current
      ladeAuftragRef.current = null
      void auftrag?.destroy().catch(() => {})
    }
  }, [fileUrl, neuVersuch, setzeAnsicht])

  /**
   * Haelt den Einpassmaszstab nach, wenn sich die Flaeche aendert - beim
   * Ein- und Ausklappen der Seitenleisten, beim Drehen des Geraets, beim
   * Aendern der Fenstergroesze.
   *
   * Der Zoom bleibt dabei stehen: wer bei 250 % arbeitet, ist danach weiter
   * bei 250 %. Nur die Verschiebung wird neu begrenzt.
   */
  useEffect(() => {
    const flaeche = flaecheRef.current
    if (!flaeche || typeof ResizeObserver === 'undefined') return

    let zeitgeber: number | null = null
    const beobachter = new ResizeObserver(() => {
      // Entprellt, weil das Ein- und Ausklappen als Uebergang laeuft und dabei
      // fortlaufend neue Breiten meldet.
      if (zeitgeber) window.clearTimeout(zeitgeber)
      zeitgeber = window.setTimeout(() => {
        const masze = seiteRef.current
        const sichtbar = flaechenMasze()
        if (!masze || !sichtbar) return
        const neu = berechneEinpassung(masze, sichtbar)
        if (neu === null) return
        einpassRef.current = neu
        setEinpass(neu)
        setzeAnsicht((v) => v)
      }, 120)
    })

    beobachter.observe(flaeche)
    return () => {
      if (zeitgeber) window.clearTimeout(zeitgeber)
      beobachter.disconnect()
    }
  }, [setzeAnsicht])

  /* ---------------------------------------------------------------------
     Bedienung
     --------------------------------------------------------------------- */

  /** Zeigerposition relativ zur Flaeche - die Bezugsgroesze der Verschiebung. */
  function inFlaeche(clientX: number, clientY: number) {
    const el = flaecheRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  function mitteDerFlaeche() {
    const f = flaechenMasze()
    return f ? { x: f.breite / 2, y: f.hoehe / 2 } : { x: 0, y: 0 }
  }

  const zoomeUm = useCallback(
    (faktor: number, punkt?: { x: number; y: number }) => {
      const ziel = punkt ?? mitteDerFlaeche()
      setzeAnsicht((v) => zoomeAufPunkt(v, ziel, faktor))
    },
    [setzeAnsicht]
  )

  const passeEinAn = useCallback(() => {
    setzeAnsicht({ ...ANSICHT_START })
  }, [setzeAnsicht])

  /**
   * Rad und Trackpad.
   *
   * Der Lauscher haengt auf der *ganzen* Flaeche, nicht nur auf dem Blatt.
   * Vorher sasz er auf der Zeichnung selbst: neben einem herausgezoomten Plan
   * kam er gar nicht an, und der Browser zoomte stattdessen die ganze Seite -
   * genau die gemeldete Beobachtung am Trackpad.
   *
   * Ein Kneifen auf dem Trackpad meldet der Browser als Rad mit gedruecktem
   * Strg; zwei Finger ohne Modifikator sind ein Schwenken in beiden Achsen.
   */
  useEffect(() => {
    const el = flaecheRef.current
    if (!el) return

    function beiRad(e: WheelEvent) {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        zoomeUm(radZuFaktor(e.deltaY, e.deltaMode), inFlaeche(e.clientX, e.clientY))
        return
      }
      // Mit gedrueckter Umschalttaste schwenkt ein Rad ohne Querachse seitlich.
      const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX
      const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY
      setzeAnsicht((v) => ({ zoom: v.zoom, x: v.x - dx, y: v.y - dy }))
    }

    el.addEventListener('wheel', beiRad, { passive: false })
    return () => el.removeEventListener('wheel', beiRad)
  }, [zoomeUm, setzeAnsicht])

  const zeigerRef = useRef(new Map<number, { x: number; y: number }>())
  const gesteRef = useRef<{ abstand: number; mitte: { x: number; y: number } } | null>(null)
  const schwenkRef = useRef<{ x: number; y: number } | null>(null)
  const tippRef = useRef<{
    x: number
    y: number
    zeit: number
    verschoben: boolean
    /**
     * Ob der Druck auf einer Nadel begann.
     *
     * Wird beim Druecken gemerkt und nicht beim Loslassen gelesen: sobald die
     * Flaeche den Zeiger erfasst, meldet der Browser alle weiteren Ereignisse
     * mit der Flaeche als Ziel. Beim Loslassen waere die Nadel dann nicht mehr
     * erkennbar - und ein Tippen auf eine bestehende Nadel legte zusaetzlich
     * ein neues Ticket an.
     */
    aufNadel: boolean
  } | null>(null)

  function zeigerPaar() {
    const [a, b] = [...zeigerRef.current.values()]
    if (!a || !b) return null
    return {
      abstand: Math.hypot(a.x - b.x, a.y - b.y),
      mitte: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    }
  }

  function beiZeigerAb(e: React.PointerEvent<HTMLDivElement>) {
    const stelle = inFlaeche(e.clientX, e.clientY)
    zeigerRef.current.set(e.pointerId, stelle)

    if (zeigerRef.current.size >= 2) {
      // Zweiter Finger: aus Schwenken wird Kneifen, und aus dem Tippen nichts.
      // Neu berechnet auch beim dritten Finger, damit das Paar nach dem
      // Absetzen eines Fingers nicht mit veralteten Werten weiterrechnet.
      gesteRef.current = zeigerPaar()
      tippRef.current = null
      schwenkRef.current = null
      return
    }

    schwenkRef.current = stelle
    tippRef.current = {
      x: stelle.x,
      y: stelle.y,
      zeit: Date.now(),
      verschoben: false,
      aufNadel: (e.target as HTMLElement).dataset.pinMarker === 'true',
    }
    // Der Zeiger wird bewusst *noch nicht* erfasst - das geschieht erst, wenn
    // aus dem Druecken ein Schwenken wird. Waere er hier schon erfasst, ginge
    // der Klick auf einer Nadel an die Flaeche und die Nadel selbst bekaeme
    // ihn nie.
  }

  function beiZeigerBewegung(e: React.PointerEvent<HTMLDivElement>) {
    if (!zeigerRef.current.has(e.pointerId)) return
    const stelle = inFlaeche(e.clientX, e.clientY)
    zeigerRef.current.set(e.pointerId, stelle)

    // Zwei Finger: Maszstab am Verhaeltnis der Abstaende, dazu das Schwenken
    // ueber die Wanderung des Mittelpunkts - beides zugleich, wie man es von
    // einer Karte kennt.
    if (zeigerRef.current.size === 2 && gesteRef.current) {
      const jetzt = zeigerPaar()
      if (!jetzt || gesteRef.current.abstand <= 0 || jetzt.abstand <= 0) return
      const faktor = jetzt.abstand / gesteRef.current.abstand
      const versatz = {
        x: jetzt.mitte.x - gesteRef.current.mitte.x,
        y: jetzt.mitte.y - gesteRef.current.mitte.y,
      }
      gesteRef.current = jetzt
      setzeAnsicht((v) => {
        const gezoomt = zoomeAufPunkt(v, jetzt.mitte, faktor)
        return { zoom: gezoomt.zoom, x: gezoomt.x + versatz.x, y: gezoomt.y + versatz.y }
      })
      return
    }

    const start = tippRef.current
    const schwenk = schwenkRef.current
    if (!start || !schwenk) return

    if (!start.verschoben && Math.hypot(stelle.x - start.x, stelle.y - start.y) > TIPP_TOLERANZ_PX) {
      start.verschoben = true
      // Erst jetzt erfassen: ab hier ist es ein Schwenken, und das soll auch
      // weiterlaufen, wenn der Zeiger die Flaeche verlaesst.
      e.currentTarget.setPointerCapture(e.pointerId)
    }

    // Schwenken gilt jetzt fuer *alle* Zeigerarten. Vorher war die Maus
    // ausgenommen und man kam am Rechner nur ueber die Scrollbalken weiter.
    if (start.verschoben) {
      const dx = stelle.x - schwenk.x
      const dy = stelle.y - schwenk.y
      schwenkRef.current = stelle
      setzeAnsicht((v) => ({ zoom: v.zoom, x: v.x + dx, y: v.y + dy }))
    }
  }

  function beiZeigerAuf(e: React.PointerEvent<HTMLDivElement>) {
    const start = tippRef.current
    zeigerRef.current.delete(e.pointerId)
    gesteRef.current = zeigerRef.current.size >= 2 ? zeigerPaar() : null
    if (zeigerRef.current.size === 0) schwenkRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }

    if (!start) return
    tippRef.current = null

    // Nadeln haben ihre eigene Behandlung ueber onClick.
    if (start.aufNadel) return
    if (start.verschoben || Date.now() - start.zeit > TIPP_HOECHSTDAUER_MS) return

    // Nur Treffer auf dem Blatt legen ein Ticket an - daneben ist leere Flaeche.
    const buehne = buehneRef.current
    if (!buehne) return
    const rect = buehne.getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width
    const relY = (e.clientY - rect.top) / rect.height
    if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return
    onCanvasClick(relX, relY)
  }

  function beiZeigerAbbruch(e: React.PointerEvent<HTMLDivElement>) {
    zeigerRef.current.delete(e.pointerId)
    gesteRef.current = null
    tippRef.current = null
    schwenkRef.current = null
  }

  function beiTaste(e: React.KeyboardEvent<HTMLDivElement>) {
    const schritt = 60
    switch (e.key) {
      case '+':
      case '=':
        zoomeUm(ZOOM_STUFE)
        break
      case '-':
      case '_':
        zoomeUm(1 / ZOOM_STUFE)
        break
      case '0':
        passeEinAn()
        break
      case 'ArrowLeft':
        setzeAnsicht((v) => ({ ...v, x: v.x + schritt }))
        break
      case 'ArrowRight':
        setzeAnsicht((v) => ({ ...v, x: v.x - schritt }))
        break
      case 'ArrowUp':
        setzeAnsicht((v) => ({ ...v, y: v.y + schritt }))
        break
      case 'ArrowDown':
        setzeAnsicht((v) => ({ ...v, y: v.y - schritt }))
        break
      default:
        return
    }
    e.preventDefault()
  }

  /* ---------------------------------------------------------------------
     Darstellung
     --------------------------------------------------------------------- */

  if (error) {
    return (
      <div className="plan-flaeche plan-flaeche-fehler">
        <p className="hinweis hinweis-fehler">PDF konnte nicht geladen werden: {error}</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNeuVersuch((c) => c + 1)}>
          Erneut versuchen
        </button>
      </div>
    )
  }

  const buehne = seite && einpass ? { breite: seite.breite * einpass, hoehe: seite.hoehe * einpass } : null

  return (
    <div
      ref={flaecheRef}
      className="plan-flaeche"
      tabIndex={0}
      aria-label="Plan. Zoomen mit Plus und Minus, zurücksetzen mit Null, schwenken mit den Pfeiltasten."
      onPointerDown={beiZeigerAb}
      onPointerMove={beiZeigerBewegung}
      onPointerUp={beiZeigerAuf}
      onPointerCancel={beiZeigerAbbruch}
      onKeyDown={beiTaste}
    >
      {buehne && (
        <div
          ref={buehneRef}
          className="plan-buehne"
          style={{
            width: buehne.breite,
            height: buehne.hoehe,
            transform: `translate(${ansicht.x}px, ${ansicht.y}px) scale(${ansicht.zoom})`,
          }}
        >
          <canvas ref={canvasRef} className="plan-blatt" />
          {points.map((point) => {
            const category = point.category_id ? categoryById.get(point.category_id) : undefined
            const color = category?.color ?? FALLBACK_COLOR
            const glyph = category?.glyph ?? FALLBACK_GLYPH
            const gewaehlt = point.id === selectedPointId
            return (
              <button
                key={point.id}
                type="button"
                data-pin-marker="true"
                className="plan-pin"
                onClick={(e) => {
                  e.stopPropagation()
                  onPointClick(point)
                }}
                title={`${point.ticket_number ? `${point.ticket_number} – ` : ''}${point.title}${category ? ` (${category.name})` : ''}`}
                style={{
                  left: `${point.x * 100}%`,
                  top: `${point.y * 100}%`,
                  background: color,
                  // Gegen den Zoom gerechnet: die Nadel behaelt ihre Groesze auf
                  // dem Bildschirm. Ohne das waere sie bei 800 % so grosz wie
                  // ein halber Raum und verdeckte, worauf sie zeigt.
                  transform: `translate(-50%, -100%) scale(${(gewaehlt ? 1.25 : 1) / ansicht.zoom})`,
                  borderColor: gewaehlt ? '#1a73e8' : '#fff',
                  boxShadow: gewaehlt
                    ? '0 0 0 3px rgba(26, 115, 232, 0.45), 0 1px 4px rgba(0,0,0,0.35)'
                    : '0 1px 4px rgba(0,0,0,0.35)',
                  zIndex: gewaehlt ? 1 : 0,
                }}
              >
                {glyph}
              </button>
            )
          })}
        </div>
      )}

      {/* Liegt auszerhalb der Buehne und wird deshalb nicht mitbewegt. */}
      <div className="pdf-zoom-toolbar" onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="icon-btn"
          onClick={() => zoomeUm(1 / ZOOM_STUFE)}
          disabled={ansicht.zoom <= ZOOM_MIN}
          title="Verkleinern (Minustaste)"
          aria-label="Verkleinern"
        >
          <Zeichen name="minus" />
        </button>
        {/* 100 % heiszt "ganze Seite sichtbar". Gegen einen festen Startwert zu
            rechnen ergab je nach Planformat voellig verschiedene Zahlen fuer
            denselben Anblick. */}
        <button
          type="button"
          className="pdf-zoom-wert"
          onClick={passeEinAn}
          title="Auf ganze Seite zurücksetzen (Taste 0)"
        >
          {Math.round(ansicht.zoom * 100)}%
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => zoomeUm(ZOOM_STUFE)}
          disabled={ansicht.zoom >= ZOOM_MAX}
          title="Vergrößern (Plustaste)"
          aria-label="Vergrößern"
        >
          <Zeichen name="plus" />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={passeEinAn}
          title="Ganze Seite einpassen (Taste 0)"
          aria-label="Ganze Seite einpassen"
        >
          <Zeichen name="einpassen" />
        </button>
        {/* Der Betrachter zeigt Seite 1, und neue Tickets werden auf Seite 1
            geschrieben. Bei einem mehrseitigen PDF waere der Rest sonst
            stillschweigend unerreichbar. */}
        {typeof seitenzahl === 'number' && seitenzahl > 1 && (
          <span className="pdf-zoom-hinweis" title="Mehrseitige Pläne werden nicht unterstützt">
            Seite 1 von {seitenzahl}
          </span>
        )}
      </div>
    </div>
  )
}
