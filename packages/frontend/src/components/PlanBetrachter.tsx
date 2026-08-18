/**
 * Die Planansicht auf Grundlage von EmbedPDF.
 *
 * Warum es diesen Baustein gibt: der selbstgebaute Betrachter
 * (components/PdfViewer.tsx) rechnet Zoom, Verschiebung, Einpassung und
 * Kachelaufloesung selbst. Vier Runden Fehlersuche an einer gemeldeten
 * Unschaerfe haben nicht dazu gefuehrt, dass die Meldung verschwindet. Die
 * Rechnung ist ohne Browser geprueft und im Browser gemessen - und trotzdem
 * bleibt eine Umgebung, in der es nicht stimmt und die ich nicht sehe.
 *
 * Also kommt der eigene Code aus der Gleichung. EmbedPDF (MIT) bringt
 * dieselbe Zwei-Ebenen-Strategie mit, die hier von Hand gebaut wurde - grobe
 * Grundebene, hochaufgeloeste Kacheln darueber - aber erprobt und in drei
 * Punkten anders:
 *
 *   - Kacheln von 768 Punkten statt einer groszen. Die eine grosze Kachel
 *     brauchte bei einem Plan mit 101549 Linienzuegen 553 bis 1281 ms, bis
 *     *irgendetwas* scharf wurde. So lange stand nur die grobe Grundebene da,
 *     und genau das sieht aus wie "die urspruengliche Groesze herangezoomt".
 *     Kleine Kacheln erscheinen einzeln und fortlaufend.
 *   - Gezeichnet wird in einem Web Worker. Der Hauptstrang blockiert nicht
 *     mehr; der frueher hier noetige Streifenbetrieb entfaellt.
 *   - Zoom, Schwenken und Einpassen kommen fertig.
 *
 * Was hier bleibt, ist das Fachliche: die Nadeln auf dem Plan und das Anlegen
 * eines Tickets per Klick.
 *
 * Der alte Betrachter laeuft daneben weiter und ist ueber die Zoomleiste
 * erreichbar - siehe PlanAnsicht.tsx. Das ist die Lehre aus den vier Runden:
 * der Nutzer soll in einem Klick sehen koennen, ob es besser wurde, statt es
 * mir glauben zu muessen.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPluginRegistration } from '@embedpdf/core'
import { EmbedPDF } from '@embedpdf/core/react'
import { usePdfiumEngine } from '@embedpdf/engines/react'
import {
  DocumentManagerPluginPackage,
  useActiveDocument,
} from '@embedpdf/plugin-document-manager/react'
import {
  ViewportPluginPackage,
  Viewport,
  useViewportElement,
} from '@embedpdf/plugin-viewport/react'
import { ScrollPluginPackage, Scroller, type PageLayout } from '@embedpdf/plugin-scroll/react'
import { RenderPluginPackage, RenderLayer } from '@embedpdf/plugin-render/react'
import { TilingPluginPackage, TilingLayer } from '@embedpdf/plugin-tiling/react'
import {
  ZoomPluginPackage,
  ZoomMode,
  ZoomGestureWrapper,
  useZoom,
} from '@embedpdf/plugin-zoom/react'
import { InteractionManagerPluginPackage } from '@embedpdf/plugin-interaction-manager/react'
import { PanPluginPackage } from '@embedpdf/plugin-pan/react'
import wasmPfad from '@embedpdf/pdfium/pdfium.wasm?url'
import type { Category, Point } from '@poi-app/shared'
import { getToken } from '../api/client'
import { Zeichen } from './Zeichen'
import { PlanDiagnoseDialog } from './PlanDiagnoseDialog'
import type { Inhaltsbefund, PlanDiagnose } from '../utils/planDiagnose'
import { geraeteDichte, radZuFaktor } from '../utils/planAnsicht'

const FALLBACK_COLOR = '#888888'
const FALLBACK_GLYPH = '!'

/**
 * Ab dieser Bewegung gilt es als Schwenken und nicht mehr als Tippen. Auf
 * einem Touchgeraet endet jede Wischbewegung als Klick - ohne die Schwelle
 * legte jeder Schwenkversuch ein neues Ticket an.
 */
const TIPP_TOLERANZ_PX = 10
const TIPP_HOECHSTDAUER_MS = 600

/** Hoechste Vergroeszerung, bezogen auf die natuerliche Groesze der Seite. */
const ZOOM_MAX = 8
const ZOOM_MIN = 0.05

/**
 * Nur ein Dokument zugleich - die Anwendung zeigt immer genau einen Plan.
 * Fest vergeben, damit der Baustein die Kennung nicht erst suchen muss.
 */
const DOKUMENT_ID = 'plan'

/**
 * Die Adresse der wasm-Datei, vollstaendig ausgeschrieben.
 *
 * Sie muss den Rechnernamen enthalten, und das ist kein Schoenheitsfehler:
 * EmbedPDF startet seinen Arbeiter aus einer `blob:`-Adresse. Darin ist
 * `self.location` die blob-Adresse selbst, und ein Pfad wie
 * `/assets/pdfium.wasm` laesst sich dagegen nicht aufloesen - der Abruf
 * schlaegt fehl.
 *
 * Das Tueckische daran war, wie es sich zeigte: der Arbeiter meldet den Fehler
 * als Nachricht vom Typ `wasmError`, und die Gegenstelle kennt diesen Typ
 * nicht. Sie verwirft ihn stillschweigend. Jede weitere Anfrage wartet
 * anschlieszend auf eine Bereitmeldung, die nie kommt - der Plan blieb ohne
 * Fehlermeldung und ohne Zeitablauf einfach leer.
 *
 * Vite loest den Import zu einem Pfad ohne Rechnernamen auf; hier wird er
 * gegen die Adresse der Seite vervollstaendigt.
 */
const WASM_URL = new URL(wasmPfad, window.location.href).href

interface PlanBetrachterProps {
  fileUrl: string
  points: Point[]
  categories: Category[]
  selectedPointId?: string
  onCanvasClick: (relX: number, relY: number) => void
  onPointClick: (point: Point) => void
  seitenzahl?: number | null
  /** Zurueck auf den selbstgebauten Betrachter. */
  onBetrachterWechsel: () => void
}

export function PlanBetrachter(props: PlanBetrachterProps) {
  const { fileUrl, onBetrachterWechsel } = props

  /**
   * Die Datei wird selbst geholt und als Speicherinhalt uebergeben, nicht als
   * Adresse.
   *
   * Zwei Gruende: der Plan-Endpunkt verlangt ein Zugangstoken, und der Service
   * Worker (public/sw.js) faengt genau diesen Pfad ab und legt eine
   * Offline-Kopie an. Beides bleibt so unveraendert erhalten.
   */
  const [daten, setDaten] = useState<ArrayBuffer | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [neuVersuch, setNeuVersuch] = useState(0)

  useEffect(() => {
    let abgebrochen = false
    setDaten(null)
    setFehler(null)

    void (async () => {
      try {
        const token = getToken()
        const antwort = await fetch(fileUrl, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`)
        const puffer = await antwort.arrayBuffer()
        if (!abgebrochen) setDaten(puffer)
      } catch (err) {
        if (!abgebrochen) setFehler(String(err))
      }
    })()

    return () => {
      abgebrochen = true
    }
  }, [fileUrl, neuVersuch])

  /**
   * PDFium als WebAssembly, aus dem eigenen Buendel.
   *
   * `wasmUrl` zeigt bewusst auf ein mitgeliefertes Asset und nicht auf ein
   * CDN: die Anwendung muss auf der Baustelle ohne Netz arbeiten.
   * `fontFallback: null` schaltet das Nachladen fehlender Schriften ab - das
   * waeren Anfragen nach drauszen, die offline scheitern und die hier auch
   * niemand erwartet.
   * `worker: true` zeichnet auszerhalb des Hauptstrangs; die Oberflaeche
   * bleibt waehrend einer schweren Kachel bedienbar.
   */
  const { engine, isLoading: motorLaedt, error: motorFehler } = usePdfiumEngine({
    wasmUrl: WASM_URL,
    worker: true,
    fontFallback: null,
  })

  const plugins = useMemo(() => {
    if (!daten) return null
    return [
      createPluginRegistration(DocumentManagerPluginPackage, {
        initialDocuments: [{ buffer: daten, name: 'Plan', documentId: DOKUMENT_ID }],
      }),
      createPluginRegistration(ViewportPluginPackage),
      createPluginRegistration(ScrollPluginPackage),
      createPluginRegistration(RenderPluginPackage),
      // Die eigentliche Antwort auf die Unschaerfe: der sichtbare Bereich wird
      // in Kacheln von 768 Punkten in voller Aufloesung nachgezeichnet.
      createPluginRegistration(TilingPluginPackage, {
        tileSize: 768,
        overlapPx: 2.5,
        extraRings: 0,
      }),
      createPluginRegistration(ZoomPluginPackage, {
        defaultZoomLevel: ZoomMode.FitPage,
        minZoom: ZOOM_MIN,
        maxZoom: ZOOM_MAX,
      }),
      createPluginRegistration(InteractionManagerPluginPackage),
      // Auf Touchgeraeten ist Ziehen die selbstverstaendliche Art zu schwenken.
      // Mit Maus bleibt es beim Rollen und den Bildlaufleisten, damit ein Klick
      // weiterhin zuverlaessig ein Ticket anlegt.
      createPluginRegistration(PanPluginPackage, { defaultMode: 'mobile' }),
    ]
  }, [daten])

  if (fehler || motorFehler) {
    return (
      <div className="plan-flaeche plan-flaeche-fehler">
        <p className="hinweis hinweis-fehler">
          PDF konnte nicht geladen werden: {fehler ?? String(motorFehler)}
        </p>
        <div className="diagnose-knopfleiste">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setNeuVersuch((c) => c + 1)}
          >
            Erneut versuchen
          </button>
          {/* Ein Ausweg, der nicht von diesem Baustein abhaengt: faellt
              EmbedPDF aus, kommt man mit einem Klick zum alten Betrachter und
              kann weiterarbeiten. */}
          <button type="button" className="btn btn-secondary btn-sm" onClick={onBetrachterWechsel}>
            Alten Betrachter verwenden
          </button>
        </div>
      </div>
    )
  }

  if (!engine || motorLaedt || !plugins) {
    return (
      <div className="plan-flaeche plan-flaeche-fehler">
        <p className="hinweis">Plan wird geladen …</p>
      </div>
    )
  }

  return (
    <EmbedPDF engine={engine} plugins={plugins}>
      <Buehne {...props} />
    </EmbedPDF>
  )
}

/**
 * Zoomen mit dem Rad, und zwar auf den Punkt unter dem Zeiger.
 *
 * Warum nicht die mitgelieferte Radbehandlung: `ZoomGestureWrapper` blendet
 * absichtlich zwischen zwei Ankern. Solange die Seite den Ausschnitt nicht
 * deutlich ueberragt, zoomt es auf die *Mitte*; erst wenn sie ihn um 30 % der
 * Breite ueberragt, folgt es ganz dem Zeiger:
 *
 *   blend = min(1, max(0, finalWidth - layoutWidth) / (layoutWidth * 0.3))
 *   tx    = txCenter + (txMouse - txCenter) * blend
 *
 * Bei einem breiten Plan, der eingepasst genau die Breite fuellt, ist das ueber
 * die ersten Stufen praktisch reines Mittelzoomen - und genau das wurde
 * beanstandet.
 *
 * Das Zoom-Plugin kann es exakt, es wird aus dem Rad-Pfad nur nicht so
 * benutzt: `requestZoom(stufe, { vx, vy })` haelt genau diesen Punkt fest und
 * rechnet die noetige Bildlaufposition selbst aus. `vx`/`vy` zaehlen von der
 * linken oberen Ecke des Viewports.
 *
 * Der Baustein muss *innerhalb* des Viewports haengen: `useViewportElement`
 * bekommt den Verweis nur von dort. Er zeichnet nichts.
 */
function RadZoom({ documentId }: { documentId: string }) {
  const viewportRef = useViewportElement()
  const { provides: zoom } = useZoom(documentId)

  /**
   * Haelt den Punkt unter dem Zeiger fest - an der tatsaechlichen Geometrie.
   *
   * Das Zoom-Plugin rechnet die Zielposition selbst aus und setzt sie auch.
   * Zwei Dinge stehen dem im Weg, beide gemessen:
   *
   *  1. *Zu frueh.* Zum Zeitpunkt der Anfrage steht das Blatt noch in alter
   *     Groesze; der Behaelter ist noch gar nicht so weit scrollbar, und die
   *     Zuweisung wird vom Browser auf das alte Maximum gekappt - bei einer
   *     eingepassten Seite auf 0. Der Inhalt wuchs auf 2274 x 999 in einem
   *     Ausschnitt von 940 x 806, scrollLeft und scrollTop blieben beide 0.
   *     EmbedPDFs eigener Gestenpfad faellt nicht darauf herein, weil er
   *     waehrend der Geste eine CSS-Skalierung anlegt - dadurch ist der
   *     Behaelter bereits scrollbar, bevor uebernommen wird.
   *
   *  2. *Falsche Annahme.* `computeScrollForZoomChange` rechnet damit, dass
   *     ein Inhalt, der kleiner als der Ausschnitt ist, in beiden Achsen
   *     mittig sitzt. Im DOM steht er aber oben - zentriert wird ueber
   *     `margin: 0 auto`, und das wirkt nur waagerecht. Bei einem breiten,
   *     flachen Plan ist der senkrechte Fehler entsprechend grosz: waagerecht
   *     stimmte es auf 2 px, senkrecht wich es um bis zu 13835 px ab.
   *
   * Deshalb wird hier nicht nachgerechnet, sondern nachgemessen: welcher Punkt
   * des Blattes lag unter dem Zeiger, und wo liegt er nach dem Umbruch? Die
   * Differenz geht auf den Bildlauf. Das kommt ohne jede Annahme ueber
   * Zentrierung, Innenabstand und Seitenluecken aus.
   *
   * Das Ereignis kommt noch *vor* dem Umbruch - der Zustand ist gesetzt, das
   * DOM aber noch alt. Genau richtig, um den Bezugspunkt zu nehmen.
   */
  useEffect(() => {
    if (!zoom) return
    return zoom.onZoomChange((e) => {
      const el = viewportRef?.current
      if (!el) return
      const blatt = el.querySelector<HTMLElement>('.plan-seite')
      if (!blatt) return

      const vorher = blatt.getBoundingClientRect()
      if (vorher.width <= 0 || vorher.height <= 0) return

      // Der festzuhaltende Punkt, einmal in Bildschirm- und einmal in
      // Blattkoordinaten (Anteile, also vom Maszstab unabhaengig).
      const ausschnitt = el.getBoundingClientRect()
      const zielX = ausschnitt.left + e.center.vx
      const zielY = ausschnitt.top + e.center.vy
      const u = (zielX - vorher.left) / vorher.width
      const v = (zielY - vorher.top) / vorher.height

      const ziehNach = (versuche: number) => {
        const jetzt = blatt.getBoundingClientRect()
        if (jetzt.width <= 0 || jetzt.height <= 0) return
        const abweichungX = jetzt.left + u * jetzt.width - zielX
        const abweichungY = jetzt.top + v * jetzt.height - zielY
        if (Math.abs(abweichungX) > 0.5) el.scrollLeft += abweichungX
        if (Math.abs(abweichungY) > 0.5) el.scrollTop += abweichungY
        // Der Umbruch braucht je nach Last mehrere Bilder; bis dahin bleibt
        // eine Abweichung stehen. Danach sitzt die erste Korrektur.
        if (versuche > 0) window.requestAnimationFrame(() => ziehNach(versuche - 1))
      }
      window.requestAnimationFrame(() => ziehNach(4))
    })
  }, [zoom, viewportRef])

  useEffect(() => {
    const el = viewportRef?.current
    if (!el || !zoom) return

    function beiRad(e: WheelEvent) {
      // Ohne Strg ist es Schwenken - das erledigt der Bildlauf des Viewports.
      // Ein Kneifen auf dem Trackpad meldet der Browser als Rad mit gedruecktem
      // Strg und landet deshalb hier.
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()

      const rechteck = (el as HTMLDivElement).getBoundingClientRect()
      const jetzt = zoom!.getState().currentZoomLevel
      // radZuFaktor rechnet stufenlos, behandelt Firefox' Zeilen-deltaMode und
      // deckelt die Ausreiszer mancher Maustreiber. Ohne das wird ein
      // Trackpad-Kneifen zum Sprung statt zu einer Bewegung.
      zoom!.requestZoom(jetzt * radZuFaktor(e.deltaY, e.deltaMode), {
        vx: e.clientX - rechteck.left,
        vy: e.clientY - rechteck.top,
      })
    }

    el.addEventListener('wheel', beiRad, { passive: false })
    return () => el.removeEventListener('wheel', beiRad)
  }, [viewportRef, zoom])

  return null
}

/**
 * Alles, was die Bausteine von EmbedPDF braucht - also erst innerhalb des
 * Anbieters moeglich.
 */
function Buehne({
  fileUrl,
  points,
  categories,
  selectedPointId,
  onCanvasClick,
  onPointClick,
  seitenzahl,
  onBetrachterWechsel,
}: PlanBetrachterProps) {
  const { activeDocumentId, activeDocument } = useActiveDocument()
  const dokumentId = activeDocumentId ?? DOKUMENT_ID
  const zustand = activeDocument?.status ?? 'unbekannt'
  /** Seitengroesze in PDF-Punkten, aus dem geoeffneten Dokument. */
  const ersteSeite = activeDocument?.document?.pages?.[0]
  const seitenMasze = ersteSeite
    ? { breite: ersteSeite.size.width, hoehe: ersteSeite.size.height }
    : null
  const seitenImDokument = activeDocument?.document?.pageCount ?? null

  const { state: zoomStand, provides: zoom } = useZoom(dokumentId)

  const [diagnose, setDiagnose] = useState<PlanDiagnose | null>(null)
  const rahmenRef = useRef<HTMLDivElement>(null)

  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  )

  const massstab = zoomStand.currentZoomLevel

  /* -----------------------------------------------------------------------
     Tippen gegen Schwenken
     ----------------------------------------------------------------------- */

  const tippRef = useRef<{ x: number; y: number; zeit: number; aufNadel: boolean } | null>(null)

  function beiZeigerAb(e: React.PointerEvent<HTMLDivElement>) {
    tippRef.current = {
      x: e.clientX,
      y: e.clientY,
      zeit: Date.now(),
      aufNadel: (e.target as HTMLElement).dataset.pinMarker === 'true',
    }
  }

  function beiZeigerAuf(e: React.PointerEvent<HTMLDivElement>) {
    const start = tippRef.current
    tippRef.current = null
    if (!start) return
    // Nadeln haben ihre eigene Behandlung ueber onClick.
    if (start.aufNadel) return
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TIPP_TOLERANZ_PX) return
    if (Date.now() - start.zeit > TIPP_HOECHSTDAUER_MS) return

    const seite = e.currentTarget.getBoundingClientRect()
    if (seite.width <= 0 || seite.height <= 0) return
    const relX = (e.clientX - seite.left) / seite.width
    const relY = (e.clientY - seite.top) / seite.height
    if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return
    onCanvasClick(relX, relY)
  }

  /* -----------------------------------------------------------------------
     Infofenster
     ----------------------------------------------------------------------- */

  async function oeffneDiagnose() {
    setDiagnose(sammleDiagnose(null))
    // Woraus die Seite besteht, beantwortet die Frage, die das Zeichnen nicht
    // beantworten kann: Linien und Text - oder ein Rasterbild fester
    // Aufloesung, an dem kein Betrachter etwas aendern kann. Nachgereicht,
    // weil das Durchgehen der Seitenobjekte bei einem groszen Plan dauert.
    try {
      const { motorPdfium } = await import('../utils/motorPdfium')
      const token = getToken()
      const dok = await motorPdfium.oeffne(
        fileUrl,
        token ? { Authorization: `Bearer ${token}` } : undefined
      )
      try {
        const inhalt = await dok.untersuche(1)
        setDiagnose((v) => (v ? { ...v, inhalt } : v))
      } finally {
        await dok.schliesse()
      }
    } catch {
      /* Ohne Inhaltsbefund bleibt der Rest brauchbar. */
    }
  }

  function sammleDiagnose(inhalt: Inhaltsbefund | null): PlanDiagnose {
    const rahmen = rahmenRef.current
    const flaeche = rahmen
      ? { breite: rahmen.clientWidth, hoehe: rahmen.clientHeight }
      : null
    const dichte = geraeteDichte(window.devicePixelRatio)

    return {
      inhalt,
      betrachter: 'neu',
      motor: 'pdfium',
      stand: __BUILD_COMMIT__,
      gebaut: new Date(__BUILD_DATE__).toLocaleDateString('de-DE'),
      // Die Seitengroesze kommt aus dem Dokument selbst - sie entscheidet mit,
      // ob eine gemeldete Unschaerfe ueberhaupt erklaerbar ist.
      seite: seitenMasze,
      // Die uebrige Geometrie fuehrt jetzt EmbedPDF. Was dieser Baustein nicht
      // mehr selbst rechnet, gibt er auch nicht vor zu wissen - lieber eine
      // Leerstelle im Auszug als eine erfundene Zahl.
      einpass: null,
      zoom: massstab,
      zoomMax: ZOOM_MAX,
      verschiebung: { x: 0, y: 0 },
      flaeche,
      punktdichte: dichte,
      grundBitmap: null,
      scharf: {
        sichtbar: true,
        fenster: null,
        bitmap: null,
        massstab: massstab * dichte,
        benoetigt: massstab * dichte,
        letzteDauerMs: null,
      },
      fehler: null,
      verlauf: [],
    }
  }

  /* -----------------------------------------------------------------------
     Darstellung
     ----------------------------------------------------------------------- */

  function nadeln(seite: PageLayout) {
    return points.map((point) => {
      const category = point.category_id ? categoryById.get(point.category_id) : undefined
      const color = category?.color ?? FALLBACK_COLOR
      const glyph = category?.glyph ?? FALLBACK_GLYPH
      const gewaehlt = point.id === selectedPointId
      return (
        <button
          key={`${seite.pageIndex}-${point.id}`}
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
            // *Keine* Gegenrechnung zum Zoom.
            //
            // EmbedPDF skaliert nicht per transform, sondern liefert
            // `renderPage` einen Rahmen, dessen Masze bereits in fertigen
            // Bildpunkten stehen - 917 px bei 17 %, 44200 px bei 800 %. Ein
            // Kind mit fester Punktgroesze behaelt seine Bildschirmgroesze
            // damit von selbst.
            //
            // Hier stand einmal `/ massstab`, uebernommen aus dem alten
            // Betrachter. Dort war es richtig: dessen Buehne lag unter
            // transform: scale(zoom), also musste die Nadel gegensteuern.
            // Hier verdreht dieselbe Zeile die Groesze in beide Richtungen -
            // bei 14 % wurde die Nadel siebenfach zu grosz und verdeckte den
            // halben Plan, bei 800 % schrumpfte sie auf drei Punkte.
            transform: `translate(-50%, -100%) scale(${gewaehlt ? 1.25 : 1})`,
            borderColor: gewaehlt ? '#1a73e8' : '#fff',
            boxShadow: gewaehlt
              ? '0 0 0 3px rgba(26, 115, 232, 0.45), 0 1px 4px rgba(0,0,0,0.35)'
              : '0 1px 4px rgba(0,0,0,0.35)',
            zIndex: gewaehlt ? 2 : 1,
          }}
        >
          {glyph}
        </button>
      )
    })
  }

  return (
    <div className="plan-flaeche plan-flaeche-neu" ref={rahmenRef}>
      <Viewport documentId={dokumentId} className="plan-viewport">
        {/* Zoomen mit dem Rad - auf den Punkt unter dem Zeiger. Siehe RadZoom. */}
        <RadZoom documentId={dokumentId} />
        {/* Zweifingergeste auf Touchgeraeten. Der Rahmen gehoert *hier* hinein
            und nicht um den Viewport herum: der Baustein lauscht auf dem
            Viewport (den er sich selbst holt) und rechnet gegen den Inhalt, auf
            dem er sitzt. Auszen angebracht kam die Geste nicht an.
            Das Rad ist ihm abgenommen, weil er dabei zwischen Mitte und Zeiger
            blendet statt dem Zeiger zu folgen. */}
        <ZoomGestureWrapper documentId={dokumentId} enableWheel={false}>
          <Scroller
            documentId={dokumentId}
            renderPage={(seite: PageLayout) => (
              <div
                className="plan-seite"
                style={{ width: seite.width, height: seite.height }}
                onPointerDown={beiZeigerAb}
                onPointerUp={beiZeigerAuf}
              >
                {/* Grundebene: die ganze Seite, sofort da, bei starkem Zoom grob. */}
                <RenderLayer
                  documentId={dokumentId}
                  pageIndex={seite.pageIndex}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                />
                {/* Kachelebene darueber: der sichtbare Bereich in voller
                    Aufloesung, kachelweise nachgereicht. */}
                <TilingLayer
                  documentId={dokumentId}
                  pageIndex={seite.pageIndex}
                  style={{ position: 'absolute', inset: 0 }}
                />
                {nadeln(seite)}
              </div>
            )}
          />
        </ZoomGestureWrapper>
      </Viewport>

      <div className="pdf-zoom-toolbar" onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="icon-btn"
          onClick={() => zoom?.zoomOut()}
          disabled={massstab <= ZOOM_MIN + 0.001}
          title="Verkleinern"
          aria-label="Verkleinern"
        >
          <Zeichen name="minus" />
        </button>
        <button
          type="button"
          className="pdf-zoom-wert"
          onClick={() => zoom?.requestZoom(ZoomMode.FitPage)}
          title="Auf ganze Seite zurücksetzen"
        >
          {Math.round(massstab * 100)}%
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => zoom?.zoomIn()}
          disabled={massstab >= ZOOM_MAX - 0.001}
          title="Vergrößern"
          aria-label="Vergrößern"
        >
          <Zeichen name="plus" />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => zoom?.requestZoom(ZoomMode.FitPage)}
          title="Ganze Seite einpassen"
          aria-label="Ganze Seite einpassen"
        >
          <Zeichen name="einpassen" />
        </button>
        {/* Der Umschalter. Er steht sichtbar in der Leiste, weil genau er die
            offene Frage beantwortet: sieht derselbe Ausschnitt im alten
            Betrachter gleich aus, liegt es nicht am Betrachter. */}
        <button
          type="button"
          className="pdf-motor-knopf"
          onClick={onBetrachterWechsel}
          title="Zum alten, selbstgebauten Betrachter wechseln"
        >
          Neu
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => void oeffneDiagnose()}
          title="Angaben zur Darstellung"
          aria-label="Angaben zur Darstellung"
        >
          <Zeichen name="info" />
        </button>
        {/* Der Wert aus dem Dokument hat Vorrang: die Spalte page_count in der
            Datenbank wird beim Hochladen nie gefuellt. */}
        {(seitenImDokument ?? seitenzahl ?? 0) > 1 && (
          <span className="pdf-zoom-hinweis" title="Mehrseitige Pläne: Tickets liegen auf Seite 1">
            {seitenImDokument ?? seitenzahl} Seiten
          </span>
        )}
        {/* Der Zustand des Dokuments gehoert sichtbar hierher.
            EmbedPDF meldet einen fehlgeschlagenen Zeichenauftrag nicht: der
            Baustein RenderLayer verwirft den Fehler ausdruecklich
            (`task.wait(erfolg, ignore)`) und zeigt einfach nichts. Genau so
            eine stille Luecke hat diese Fehlersuche vier Runden gekostet -
            hier bleibt sie nicht stumm. */}
        {zustand !== 'loaded' && (
          <span
            className={`pdf-zoom-hinweis ${zustand === 'error' ? 'pdf-zoom-hinweis-fehler' : ''}`}
            title={`Zustand des Dokuments: ${zustand}`}
          >
            {zustand === 'error' ? 'Plan nicht lesbar' : 'Plan wird geöffnet …'}
          </span>
        )}
      </div>

      {diagnose && <PlanDiagnoseDialog diagnose={diagnose} onClose={() => setDiagnose(null)} />}
    </div>
  )
}
