import { useCallback, useEffect, useRef, useState } from 'react'
import type { Category, Point } from '@poi-app/shared'
import { getToken } from '../api/client'
import { Zeichen } from './Zeichen'
import { PlanDiagnoseDialog } from './PlanDiagnoseDialog'
import {
  schreibeVerlauf,
  type Inhaltsbefund,
  type PlanDiagnose,
  type Verlaufseintrag,
} from '../utils/planDiagnose'
import {
  MOTOR_NAME,
  istAbbruch,
  type Blatt,
  type Dokument,
  type Motor,
  type MotorKennung,
  type Zeichnung,
} from '../utils/pdfMotor'
import {
  ANSICHT_START,
  berechneZoomMax,
  ZOOM_MIN,
  ZOOM_STUFE,
  begrenzeVerschiebung,
  berechneEinpassung,
  berechneScharfMassstab,
  berechneSichtfenster,
  geraeteDichte,
  liegtDrin,
  radZuFaktor,
  zoomeAufPunkt,
  type Ansicht,
  type Masze,
  type Rechteck,
} from '../utils/planAnsicht'

const FALLBACK_COLOR = '#888888'
const FALLBACK_GLYPH = '!'

/**
 * Ab dieser Bewegung gilt es als Schwenken und nicht mehr als Tippen. Auf einem
 * Touchgeraet endet jede Wischbewegung als Klick - ohne die Schwelle legte
 * jeder Schwenkversuch ein neues Ticket an.
 */
const TIPP_TOLERANZ_PX = 10
const TIPP_HOECHSTDAUER_MS = 600

/** Ruhe nach der Geste, bevor scharf nachgezeichnet wird. */
const NACHSCHAERFEN_MS = 150

/** Wartezeit vor dem einen erlaubten zweiten Versuch. */
const ZWEITER_VERSUCH_MS = 400

/* ---------------------------------------------------------------------------
   Motorwahl
   ------------------------------------------------------------------------- */

const MOTOR_SPEICHER = 'poi.planmotor'

/**
 * PDFium ist die Vorgabe - derselbe Motor, mit dem Chrome PDF anzeigt.
 * pdf.js bleibt umschaltbar, damit sich bei einer Beanstandung in zwei Klicks
 * klaeren laesst, ob es am Motor liegt oder an der Datei.
 */
const MOTOR_VORGABE: MotorKennung = 'pdfium'

/**
 * Nachgelagert geladen, und zwar beide.
 *
 * Zusammen bringen die Motoren rund 1,6 MB JavaScript mit - pdf.js seinen
 * Arbeiter, PDFium die Bruecke zum WebAssembly. Statisch eingebunden zahlte das
 * jeder Seitenaufruf, auch wer nur Tickets durchsieht und keinen Plan oeffnet.
 * Die 4,6 MB grosze wasm-Datei selbst kommt ohnehin erst beim ersten Plan.
 */
async function motorFuer(kennung: MotorKennung): Promise<Motor> {
  if (kennung === 'pdfjs') return (await import('../utils/motorPdfJs')).motorPdfJs
  return (await import('../utils/motorPdfium')).motorPdfium
}

function gemerkterMotor(): MotorKennung {
  try {
    const wert = window.localStorage.getItem(MOTOR_SPEICHER)
    return wert === 'pdfjs' || wert === 'pdfium' ? wert : MOTOR_VORGABE
  } catch {
    // Ohne Zugriff auf den Speicher (private Sitzung, gesperrte Einstellung)
    // bleibt es bei der Vorgabe.
    return MOTOR_VORGABE
  }
}

/* ---------------------------------------------------------------------------
   Zeichenauftraege
   ------------------------------------------------------------------------- */

/**
 * Haelt die Zeichenauftraege *einer* Ebene auseinander.
 *
 * Beide Motoren vertragen es nicht, wenn zwei Zeichnungen gleichzeitig auf
 * dasselbe Canvas laufen: pdf.js weist es ausdruecklich zurueck ("Cannot use
 * the same canvas during multiple render() operations"), und PDFium schriebe
 * die Streifen der alten Zeichnung in ein inzwischen anders groszes Canvas.
 *
 * Ein neuer Auftrag bricht deshalb den laufenden ab, wartet dessen
 * *tatsaechliches* Ende ab und steigt aus, falls er inzwischen selbst ueberholt
 * wurde. Erst danach wird ein Canvas angefasst.
 */
interface Zeichenschlange {
  marke: number
  laufend: Zeichnung | null
  fertig: Promise<void>
}

function neueSchlange(): Zeichenschlange {
  return { marke: 0, laufend: null, fertig: Promise.resolve() }
}

async function reiheEin(
  schlange: Zeichenschlange,
  auftrag: (istAktuell: () => boolean, setzeLaufend: (z: Zeichnung) => void) => Promise<void>
): Promise<void> {
  const meine = ++schlange.marke
  schlange.laufend?.abbrechen()

  const vorher = schlange.fertig
  let melde: () => void = () => {}
  schlange.fertig = new Promise<void>((r) => (melde = r))

  try {
    await vorher
    if (meine !== schlange.marke) return
    await auftrag(
      () => meine === schlange.marke,
      (z) => {
        schlange.laufend = z
      }
    )
  } finally {
    if (schlange.laufend && meine === schlange.marke) schlange.laufend = null
    melde()
  }
}

/**
 * Haelt eine Entscheidung des Schaerfe-Effekts fest.
 *
 * Der Verlauf beantwortet die Frage, die eine zweimal gescheiterte Fehlersuche
 * offenliesz: *passiert ueberhaupt etwas?* Ringpuffer in einem Ref - er loest
 * keinen Renderdurchlauf aus und aendert am Verhalten nichts.
 */
function merke(puffer: Verlaufseintrag[], was: Verlaufseintrag['was'], text: string): void {
  schreibeVerlauf(puffer, was, text, Date.now())
}

/** Zahl mit zwei Nachkommastellen, ohne Laendereinstellungen. */
function z2(wert: number): string {
  return wert.toFixed(2)
}

/**
 * Die Planansicht.
 *
 * Der tragende Gedanke: Sehen und Zeichnen sind getrennt.
 *
 *   .plan-flaeche      der sichtbare Ausschnitt, faengt alle Eingaben ab
 *     .plan-buehne     feste CSS-Groesze (Seite im Einpassmaszstab),
 *                      bewegt wird sie ueber transform - sofort, ohne Umbruch
 *       Grundebene     die ganze Seite, einmal gezeichnet. Bei starkem Zoom
 *                      unscharf, aber immer sofort da.
 *       Scharfebene    nur der sichtbare Ausschnitt, in voller Aufloesung.
 *       Pins           weiterhin in Prozent, wachsen aber nicht mit
 *
 * Zwei Ebenen und nicht eine, weil die ganze Seite in voller Aufloesung nicht
 * darstellbar ist: ein A1-Plan bei 800 % braeuchte rund 1,6 GB. Nur den
 * Ausschnitt zu zeichnen kostet dagegen unabhaengig vom Zoom immer gleich
 * viel. Die Grundebene darunter sorgt dafuer, dass beim Schwenken kein weiszes
 * Loch entsteht, solange der scharfe Ausschnitt noch nachzieht.
 *
 * *Wie* gezeichnet wird, steht nicht mehr hier: das erledigt ein Motor hinter
 * der Schnittstelle in utils/pdfMotor.ts. Der Baustein kennt nur noch
 * "zeichne diesen Ausschnitt in dieser Aufloesung".
 */
interface PdfViewerProps {
  fileUrl: string
  points: Point[]
  categories: Category[]
  selectedPointId?: string
  onCanvasClick: (relX: number, relY: number) => void
  onPointClick: (point: Point) => void
  /** Aus der Datenbank; der Motor weisz es genauer und hat Vorrang. */
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
  const grundCanvasRef = useRef<HTMLCanvasElement>(null)
  const scharfCanvasRef = useRef<HTMLCanvasElement>(null)
  const dokRef = useRef<Dokument | null>(null)
  /**
   * Seite 1, einmal geholt.
   *
   * Frueher wurde vor jeder Zeichnung `getPage` aufgerufen - ein `await`
   * zwischen dem Abbrechen des vorigen Auftrags und dem Zeichnen, ueber das
   * sich zwei Auftraege verschraenken konnten. Ein einmal geholtes Blatt macht
   * das Zeichnen bis zum Auftrag synchron; die Luecke gibt es nicht mehr.
   */
  const blattRef = useRef<Blatt | null>(null)
  // Je Ebene eine Schlange: die beiden zeichnen auf verschiedene Canvas und
  // duerfen deshalb nebeneinanderher laufen - nur je Ebene nicht.
  const grundSchlange = useRef<Zeichenschlange>(neueSchlange())
  const scharfSchlange = useRef<Zeichenschlange>(neueSchlange())

  const [error, setError] = useState<string | null>(null)
  const [neuVersuch, setNeuVersuch] = useState(0)
  /** Seitengroesze in PDF-Punkten (Maszstab 1). */
  const [seite, setSeite] = useState<Masze | null>(null)
  /** Bildschirmpunkte je PDF-Punkt, wenn die ganze Seite sichtbar ist. */
  const [einpass, setEinpass] = useState<number | null>(null)
  const [ansicht, setAnsicht] = useState<Ansicht>(ANSICHT_START)
  /**
   * Der Ausschnitt, der gerade scharf vorliegt - in Buehnenkoordinaten, samt
   * der Aufloesung, in der er gezeichnet wurde. Als Zustand, weil das Canvas
   * danach im Baum positioniert wird.
   */
  const [scharf, setScharf] = useState<{ fenster: Rechteck; massstab: number } | null>(null)
  /**
   * Ein Zeichenfehler, der auch nach dem zweiten Versuch geblieben ist.
   *
   * Er wird angezeigt statt verschluckt. Genau daran lag es einmal: der Fehler
   * fiel in ein `void` und niemand erfuhr davon - der Plan blieb unscharf.
   */
  const [zeichenFehler, setZeichenFehler] = useState<string | null>(null)
  /**
   * Ob die Scharfebene der aktuellen Ansicht hinterherhaengt.
   *
   * Normalerweise ein Wimpernschlag. Bleibt es dabei, stimmt etwas nicht - und
   * genau das soll man sehen koennen.
   */
  const [schaerfeLaeuft, setSchaerfeLaeuft] = useState(false)
  /** Siehe Verlaufseintrag: beantwortet, ob ueberhaupt etwas passiert. */
  const verlaufRef = useRef<Verlaufseintrag[]>([])
  /** Dauer der letzten erfolgreichen Zeichnung der Scharfebene, in ms. */
  const letzteDauerRef = useRef<number | null>(null)
  const [diagnose, setDiagnose] = useState<PlanDiagnose | null>(null)

  /** Was der Benutzer gewaehlt hat. */
  const [motor, setMotor] = useState<MotorKennung>(gemerkterMotor)
  /** Was tatsaechlich zeichnet - kann davon abweichen, siehe Rueckfall unten. */
  const [genutzterMotor, setGenutzterMotor] = useState<MotorKennung>(motor)
  const [motorHinweis, setMotorHinweis] = useState<string | null>(null)
  /** Seitenzahl aus dem Dokument; genauer als der Wert aus der Datenbank. */
  const [seitenImDokument, setSeitenImDokument] = useState<number | null>(null)

  /**
   * Seitengroesze und Einpassmaszstab zusaetzlich als Ref.
   *
   * Der ResizeObserver und die Zeigerbehandlung werden genau einmal gesetzt.
   * Ohne Ref rechneten sie mit dem Stand aus ihrer Closure - beim Zoomen also
   * fortlaufend mit dem Ausgangswert.
   */
  const einpassRef = useRef<number | null>(null)
  const seiteRef = useRef<Masze | null>(null)

  /**
   * Der Anblick, der einen Motorwechsel ueberdauern soll.
   *
   * Ein Wechsel laedt das Dokument neu und setzt die Ansicht sonst zurueck.
   * Genau beim Vergleichen der beiden Motoren waere das laestig: man will
   * denselben Ausschnitt bei demselben Zoom sehen, nicht wieder die ganze
   * Seite.
   */
  const wiederherstellenRef = useRef<Ansicht | null>(null)

  /**
   * Wie weit sich hineinzoomen laesst - abhaengig vom Einpassmaszstab, damit
   * die Grenze in natuerlicher Groesze zaehlt und nicht in Vielfachen des
   * Einpassens. Siehe berechneZoomMax.
   */
  const zoomMax = berechneZoomMax(einpass)
  const zoomMaxRef = useRef(zoomMax)
  zoomMaxRef.current = zoomMax

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

  /** Maszstab, in dem die Grundebene vorliegt (Bildpunkte je Buehnenpunkt). */
  const grundRef = useRef<number | null>(null)
  /**
   * Dasselbe fuer die Scharfebene - als Ref, weil der Zeitgeber es liest.
   *
   * `einpass` gehoert mit hinein: `fenster` steht in Buehnenkoordinaten, und
   * die bedeuten bei einem anderen Einpassmaszstab etwas anderes. Ohne diesen
   * Vergleich koennte die Abkuerzung weiter unten nach dem Ein- oder
   * Ausklappen einer Leiste faelschlich greifen und ein veraltetes Bild stehen
   * lassen.
   */
  const scharfRef = useRef<{ fenster: Rechteck; massstab: number; einpass: number } | null>(null)
  const schaerfenRef = useRef<number | null>(null)

  /**
   * Die ganze Seite in der Aufloesung, die bei 100 % gebraucht wird.
   *
   * Sie ist damit nie groeszer als die Zeichenflaeche selbst und kostet immer
   * gleich viel. Bei starkem Zoom ist sie unscharf - dafuer liegt sie sofort
   * vor, sodass beim Schwenken kein weiszes Loch entsteht.
   */
  const zeichneGrund = useCallback(async (buehne: Masze, blattMassstab: number, dichte: number) => {
    await reiheEin(grundSchlange.current, async (istAktuell, setzeLaufend) => {
      const blatt = blattRef.current
      const canvas = grundCanvasRef.current
      if (!blatt || !canvas || !istAktuell()) return

      const zeichnung = blatt.zeichne(
        canvas,
        { x: 0, y: 0, breite: buehne.breite, hoehe: buehne.hoehe },
        blattMassstab,
        dichte
      )
      setzeLaufend(zeichnung)
      try {
        await zeichnung.fertig
        grundRef.current = dichte
      } catch (err) {
        if (!istAbbruch(err)) throw err
      }
    })
  }, [])

  /**
   * Nur der sichtbare Ausschnitt, dafuer punktgenau.
   *
   * Ein Buehnenpunkt entspricht auf dem Bildschirm `zoom` CSS-Punkten, also
   * `zoom * dichte` Geraetepunkten. Genau so viele Bildpunkte bekommt er hier -
   * deshalb ist das Ergebnis bei jedem Maszstab scharf.
   */
  const zeichneScharf = useCallback(
    async (fenster: Rechteck, blattMassstab: number, massstab: number) => {
      if (fenster.breite <= 0 || fenster.hoehe <= 0) return

      await reiheEin(scharfSchlange.current, async (istAktuell, setzeLaufend) => {
        const blatt = blattRef.current
        const canvas = scharfCanvasRef.current
        if (!blatt || !canvas) return
        if (!istAktuell()) {
          merke(verlaufRef.current, 'abgebrochen', 'ueberholt vor dem Zeichnen')
          return
        }

        // Die Uhr laeuft vor dem Aufruf, nicht danach: beide Motoren erledigen
        // einen Teil der Arbeit noch synchron in `zeichne` selbst. Danach
        // gemessen stand im Infofenster einmal "0 ms" fuer eine Zeichnung, die
        // in Wahrheit gedauert hat.
        const beginn = Date.now()
        const zeichnung = blatt.zeichne(canvas, fenster, blattMassstab, massstab)
        setzeLaufend(zeichnung)
        try {
          await zeichnung.fertig
          letzteDauerRef.current = Date.now() - beginn
          scharfRef.current = { fenster, massstab, einpass: blattMassstab }
          setScharf({ fenster, massstab })
          setZeichenFehler(null)
          setSchaerfeLaeuft(false)
          merke(
            verlaufRef.current,
            'gezeichnet',
            `Maszstab ${z2(massstab)}, Bitmap ${canvas.width}x${canvas.height}, ` +
              `Fenster ${Math.round(fenster.breite)}x${Math.round(fenster.hoehe)} ` +
              `bei ${Math.round(fenster.x)}/${Math.round(fenster.y)}, ` +
              `${letzteDauerRef.current} ms`
          )
        } catch (err) {
          if (!istAbbruch(err)) {
            merke(verlaufRef.current, 'fehlgeschlagen', String(err))
            throw err
          }
          merke(verlaufRef.current, 'abgebrochen', 'Zeichnung abgebrochen')
        }
      })
    },
    []
  )

  /** Grundebene: einmal je Plan und je Groeszenaenderung der Flaeche. */
  useEffect(() => {
    if (!seite || !einpass) return
    const dichte = geraeteDichte(window.devicePixelRatio)
    void zeichneGrund(
      { breite: seite.breite * einpass, hoehe: seite.hoehe * einpass },
      einpass,
      dichte
    )
  }, [seite, einpass, zeichneGrund])

  /**
   * Scharfebene: sobald die Geste steht.
   *
   * Bis dahin bleibt der vorhandene Ausschnitt an seinem Platz und wird
   * mitskaliert - man sieht also durchgehend etwas, es wird nur kurz weich.
   *
   * Ausgeloest von jeder Aenderung der Ansicht, also auch vom Schwenken:
   * anders als die Aufloesung haengt der *Ausschnitt* sehr wohl davon ab.
   */
  useEffect(() => {
    if (!seite || !einpass) return
    const buehne = { breite: seite.breite * einpass, hoehe: seite.hoehe * einpass }
    const flaeche = flaechenMasze()
    // Beide Kanten pruefen. Vorher stand hier nur die Breite - bei einer
    // Flaeche ohne Hoehe kam ein Ausschnitt der Hoehe null heraus, den
    // zeichneScharf stillschweigend verwarf. Die Scharfebene waere dann nie
    // entstanden, ohne dass irgendetwas darauf hingewiesen haette.
    if (!flaeche || flaeche.breite <= 0 || flaeche.hoehe <= 0) {
      merke(
        verlaufRef.current,
        'uebersprungen',
        `Flaeche ohne Masze (${flaeche?.breite ?? '?'} x ${flaeche?.hoehe ?? '?'})`
      )
      return
    }

    const dichte = geraeteDichte(window.devicePixelRatio)
    const mitRand = berechneSichtfenster(ansicht, buehne, flaeche)
    const wunsch = berechneScharfMassstab(ansicht.zoom, dichte, mitRand)
    if (mitRand.breite <= 0 || mitRand.hoehe <= 0) {
      merke(verlaufRef.current, 'uebersprungen', 'Sichtfenster ohne Masze')
      return
    }

    // Nichts tun, wenn der vorhandene Ausschnitt das Sichtbare noch abdeckt
    // *und* fein genug ist. Ohne diese Pruefung zeichnete jede Verschiebung um
    // einen Punkt die ganze Flaeche neu - dafuer ist der Rand ja da.
    const vorhanden = scharfRef.current?.einpass === einpass ? scharfRef.current : null
    const ohneRand = berechneSichtfenster(ansicht, buehne, flaeche, 0)
    if (vorhanden && liegtDrin(ohneRand, vorhanden.fenster) && vorhanden.massstab >= wunsch * 0.98) {
      merke(
        verlaufRef.current,
        'uebersprungen',
        `Ausschnitt reicht noch: vorhanden ${z2(vorhanden.massstab)}, noetig ${z2(wunsch)}`
      )
      return
    }

    // Beim ersten Ausschnitt sofort: sonst saehe man den Plan zwar, aber
    // 150 ms lang nur in der groben Grundebene.
    const verzoegerung = vorhanden ? NACHSCHAERFEN_MS : 0
    merke(
      verlaufRef.current,
      'geplant',
      `Maszstab ${z2(wunsch)} (vorhanden ${vorhanden ? z2(vorhanden.massstab) : 'keiner'}), ` +
        `Zoom ${z2(ansicht.zoom)}, Punktdichte ${dichte}, in ${verzoegerung} ms`
    )
    setSchaerfeLaeuft(true)
    if (schaerfenRef.current) window.clearTimeout(schaerfenRef.current)
    schaerfenRef.current = window.setTimeout(() => {
      schaerfenRef.current = null
      zeichneScharf(mitRand, einpass, wunsch).catch(() => {
        // Ein Versuch darf schiefgehen - danach wird es gemeldet statt
        // verschluckt. Vorher endete jeder Fehler hier als unbeachtete
        // Ablehnung und der Plan blieb stumm unscharf.
        schaerfenRef.current = window.setTimeout(() => {
          schaerfenRef.current = null
          zeichneScharf(mitRand, einpass, wunsch).catch((err: unknown) => {
            setZeichenFehler(err instanceof Error ? err.message : String(err))
          })
        }, ZWEITER_VERSUCH_MS)
      })
    }, verzoegerung)

    // Bewusst keine Aufraeumfunktion: sie liefe auch dann, wenn der naechste
    // Durchlauf den fruehen Ausgang nimmt - dann waere der Zeitgeber geloescht
    // und nie neu gesetzt. Geloescht wird beim Neuplanen (oben) und beim
    // Verlassen des Bausteins (weiter unten).
  }, [seite, einpass, ansicht, zeichneScharf])

  // Beim Verlassen: keinen Zeitgeber und keinen Zeichenauftrag hinterlassen.
  useEffect(() => {
    const grund = grundSchlange.current
    const scharfS = scharfSchlange.current
    return () => {
      if (schaerfenRef.current) window.clearTimeout(schaerfenRef.current)
      grund.marke++
      scharfS.marke++
      grund.laufend?.abbrechen()
      scharfS.laufend?.abbrechen()
    }
  }, [])

  /* ---------------------------------------------------------------------
     Laden
     --------------------------------------------------------------------- */

  useEffect(() => {
    let abgebrochen = false
    const grundS = grundSchlange.current
    const scharfS = scharfSchlange.current
    setError(null)
    setSeite(null)
    setEinpass(null)
    setSeitenImDokument(null)
    seiteRef.current = null
    einpassRef.current = null
    grundRef.current = null
    scharfRef.current = null
    setScharf(null)
    setZeichenFehler(null)
    setAnsicht(ANSICHT_START)

    async function lade() {
      const token = getToken()
      const kopfzeilen = token ? { Authorization: `Bearer ${token}` } : undefined

      /**
       * Oeffnet mit dem gewaehlten Motor - und faellt auf den anderen zurueck,
       * wenn das nicht geht.
       *
       * PDFium braucht eine 4,6 MB grosze wasm-Datei. Wird sie von einer
       * Betriebsrichtlinie geblockt oder ist der Speicher zu knapp, waere der
       * Plan sonst schlicht nicht mehr zu sehen. Der Rueckfall wird angezeigt
       * und nicht verschwiegen.
       */
      async function oeffne(): Promise<{ dok: Dokument; kennung: MotorKennung }> {
        try {
          const gewaehlt = await motorFuer(motor)
          return { dok: await gewaehlt.oeffne(fileUrl, kopfzeilen), kennung: motor }
        } catch (err) {
          const ersatz: MotorKennung = motor === 'pdfium' ? 'pdfjs' : 'pdfium'
          merke(
            verlaufRef.current,
            'fehlgeschlagen',
            `${MOTOR_NAME[motor]} nicht verfuegbar (${String(err)}) - Rueckfall auf ${MOTOR_NAME[ersatz]}`
          )
          const dok = await (await motorFuer(ersatz)).oeffne(fileUrl, kopfzeilen)
          if (!abgebrochen) {
            setMotorHinweis(
              `${MOTOR_NAME[motor]} steht nicht zur Verfügung – ${MOTOR_NAME[ersatz]} zeichnet.`
            )
          }
          return { dok, kennung: ersatz }
        }
      }

      try {
        const { dok, kennung } = await oeffne()
        if (abgebrochen) {
          void dok.schliesse()
          return
        }
        dokRef.current = dok
        setGenutzterMotor(kennung)
        setSeitenImDokument(dok.seitenzahl)

        const blatt = await dok.blatt(1)
        if (abgebrochen) {
          blatt.gibFrei()
          return
        }
        blattRef.current = blatt

        const masze = blatt.masze
        const flaeche = flaechenMasze()
        const eingepasst = flaeche ? berechneEinpassung(masze, flaeche) : null

        seiteRef.current = masze
        einpassRef.current = eingepasst
        setSeite(masze)
        setEinpass(eingepasst)
        merke(
          verlaufRef.current,
          'geladen',
          `${MOTOR_NAME[kennung]}: Seite ${Math.round(masze.breite)} x ${Math.round(masze.hoehe)} pt, ` +
            `Flaeche ${flaeche?.breite ?? '?'} x ${flaeche?.hoehe ?? '?'}, ` +
            `Einpassmaszstab ${eingepasst === null ? 'unbekannt' : eingepasst.toFixed(4)}`
        )
        // Gezeichnet wird nicht hier, sondern in den Effekten darueber - sie
        // sind die einzige Stelle, die den Zeichenmaszstab bestimmt.
        if (eingepasst === null) return
        const zurueck = wiederherstellenRef.current
        wiederherstellenRef.current = null
        setzeAnsicht(zurueck ?? { ...ANSICHT_START })
      } catch (err) {
        if (!abgebrochen) setError(String(err))
      }
    }

    void lade()
    return () => {
      abgebrochen = true
      // Erst abbrechen, dann freigeben: ein Schlieszen waehrend einer
      // laufenden Zeichnung bricht mit einer Ausnahme ab, und bei PDFium liest
      // die Zeichnung anschlieszend aus freigegebenem Speicher.
      //
      // Die Marke hochzuzaehlen ist dabei das Entscheidende: ein Auftrag, der
      // gerade wartet, gilt danach als ueberholt und fasst kein Canvas mehr an.
      grundS.marke++
      scharfS.marke++
      grundS.laufend?.abbrechen()
      scharfS.laufend?.abbrechen()
      const blatt = blattRef.current
      const dok = dokRef.current
      blattRef.current = null
      dokRef.current = null
      blatt?.gibFrei()
      void dok?.schliesse()
    }
  }, [fileUrl, neuVersuch, motor, setzeAnsicht])

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
      setzeAnsicht((v) => zoomeAufPunkt(v, ziel, faktor, zoomMaxRef.current))
    },
    [setzeAnsicht]
  )

  const passeEinAn = useCallback(() => {
    setzeAnsicht({ ...ANSICHT_START })
  }, [setzeAnsicht])

  /** Motor umschalten - der Anblick bleibt, damit sich vergleichen laesst. */
  function wechsleMotor() {
    const naechster: MotorKennung = motor === 'pdfium' ? 'pdfjs' : 'pdfium'
    wiederherstellenRef.current = ansicht
    setMotorHinweis(null)
    setMotor(naechster)
    try {
      window.localStorage.setItem(MOTOR_SPEICHER, naechster)
    } catch {
      // Die Wahl gilt dann nur fuer diese Sitzung.
    }
  }

  /**
   * Rad und Trackpad.
   *
   * Der Lauscher haengt auf der *ganzen* Flaeche, nicht nur auf dem Blatt.
   * Vorher sasz er auf der Zeichnung selbst: neben einem herausgezoomten Plan
   * kam er gar nicht an, und der Browser zoomte stattdessen die ganze Seite.
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
        const gezoomt = zoomeAufPunkt(v, jetzt.mitte, faktor, zoomMaxRef.current)
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
    const buehneEl = buehneRef.current
    if (!buehneEl) return
    const rect = buehneEl.getBoundingClientRect()
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
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setNeuVersuch((c) => c + 1)}
        >
          Erneut versuchen
        </button>
      </div>
    )
  }

  const buehne =
    seite && einpass ? { breite: seite.breite * einpass, hoehe: seite.hoehe * einpass } : null
  const seitenGesamt = seitenImDokument ?? seitenzahl ?? null

  /**
   * Die Werte fuer das Infofenster - erst beim Oeffnen zusammengetragen,
   * damit im Normalbetrieb nichts davon Arbeit macht.
   */
  async function oeffneDiagnose() {
    setDiagnose(sammleDiagnose(null))
    // Der Inhalt wird nachgereicht: das Durchgehen der Seitenobjekte dauert
    // bei einem groszen Plan einen Moment, und das Fenster soll sofort stehen.
    const dok = dokRef.current
    if (!dok) return
    try {
      const inhalt = await dok.untersuche(1)
      setDiagnose((v) => (v ? { ...v, inhalt } : v))
    } catch {
      /* Ohne Inhaltsbefund bleibt der Rest brauchbar. */
    }
  }

  function sammleDiagnose(inhalt: Inhaltsbefund | null): PlanDiagnose {
    const flaeche = flaechenMasze()
    const dichte = geraeteDichte(window.devicePixelRatio)
    const scharfCanvas = scharfCanvasRef.current
    const grundCanvas = grundCanvasRef.current
    const benoetigt =
      buehne && flaeche
        ? berechneScharfMassstab(ansicht.zoom, dichte, berechneSichtfenster(ansicht, buehne, flaeche))
        : null

    return {
      inhalt,
      motor: genutzterMotor,
      stand: __BUILD_COMMIT__,
      gebaut: new Date(__BUILD_DATE__).toLocaleDateString('de-DE'),
      seite,
      einpass,
      zoom: ansicht.zoom,
      zoomMax,
      verschiebung: { x: ansicht.x, y: ansicht.y },
      flaeche,
      punktdichte: dichte,
      grundBitmap: grundCanvas ? { breite: grundCanvas.width, hoehe: grundCanvas.height } : null,
      scharf: {
        sichtbar: scharf !== null,
        fenster: scharf?.fenster ?? null,
        bitmap: scharfCanvas ? { breite: scharfCanvas.width, hoehe: scharfCanvas.height } : null,
        massstab: scharf?.massstab ?? null,
        benoetigt,
        letzteDauerMs: letzteDauerRef.current,
      },
      fehler: zeichenFehler ?? motorHinweis,
      verlauf: [...verlaufRef.current],
    }
  }

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
          {/* Grundebene: die ganze Seite, bei starkem Zoom unscharf. */}
          <canvas ref={grundCanvasRef} className="plan-blatt-grund" />
          {/* Scharfebene darueber, nur der sichtbare Ausschnitt. Sie liegt in
              Buehnenkoordinaten, wird also von derselben Transformation
              bewegt und sitzt beim Schwenken sofort an der richtigen Stelle. */}
          <canvas
            ref={scharfCanvasRef}
            className="plan-blatt-scharf"
            style={
              scharf
                ? {
                    left: scharf.fenster.x,
                    top: scharf.fenster.y,
                    width: scharf.fenster.breite,
                    height: scharf.fenster.hoehe,
                  }
                : { display: 'none' }
            }
          />
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
        {/* Prozent der *natuerlichen* Groesze der Seite - dieselbe Zaehlweise
            wie in Acrobat und jedem anderen Betrachter. */}
        <button
          type="button"
          className="pdf-zoom-wert"
          onClick={passeEinAn}
          title="Auf ganze Seite zurücksetzen (Taste 0)"
        >
          {Math.round(ansicht.zoom * (einpass ?? 1) * 100)}%
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => zoomeUm(ZOOM_STUFE)}
          disabled={ansicht.zoom >= zoomMax - 0.001}
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
        {/* Der Umschalter steht sichtbar in der Leiste und nicht in einem
            versteckten Entwicklermodus: gebraucht wird er genau dann, wenn
            jemand im Betrieb eine Darstellung beanstandet. Der Anblick bleibt
            dabei stehen, sodass sich derselbe Ausschnitt vergleichen laesst. */}
        <button
          type="button"
          className="pdf-motor-knopf"
          onClick={wechsleMotor}
          title={`Zeichenmotor: ${MOTOR_NAME[genutzterMotor]}. Umschalten auf ${MOTOR_NAME[genutzterMotor === 'pdfium' ? 'pdfjs' : 'pdfium']}.`}
        >
          {MOTOR_NAME[genutzterMotor]}
        </button>
        {/* Sagt, was die Ansicht gerade tut. */}
        <button
          type="button"
          className="icon-btn"
          onClick={() => void oeffneDiagnose()}
          title="Angaben zur Darstellung"
          aria-label="Angaben zur Darstellung"
        >
          <Zeichen name="info" />
        </button>
        {/* Der Betrachter zeigt Seite 1, und neue Tickets werden auf Seite 1
            geschrieben. Bei einem mehrseitigen PDF waere der Rest sonst
            stillschweigend unerreichbar. */}
        {typeof seitenGesamt === 'number' && seitenGesamt > 1 && (
          <span className="pdf-zoom-hinweis" title="Mehrseitige Pläne werden nicht unterstützt">
            Seite 1 von {seitenGesamt}
          </span>
        )}
        {/* Ohne diese Anzeige war der Fehlerfall unsichtbar: der Plan blieb
            einfach unscharf, und nichts wies darauf hin, dass das Zeichnen
            fehlgeschlagen war. */}
        {zeichenFehler ? (
          <span className="pdf-zoom-hinweis pdf-zoom-hinweis-fehler" title={zeichenFehler}>
            Scharfzeichnen fehlgeschlagen
          </span>
        ) : motorHinweis ? (
          <span className="pdf-zoom-hinweis pdf-zoom-hinweis-fehler" title={motorHinweis}>
            Ersatzmotor
          </span>
        ) : (
          schaerfeLaeuft && (
            <span className="pdf-zoom-hinweis pdf-zoom-hinweis-laeuft">wird geschärft …</span>
          )
        )}
      </div>

      {diagnose && <PlanDiagnoseDialog diagnose={diagnose} onClose={() => setDiagnose(null)} />}
    </div>
  )
}
