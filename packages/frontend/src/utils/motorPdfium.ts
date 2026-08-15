/**
 * PDFium als WebAssembly - derselbe Motor, mit dem Chrome PDF anzeigt.
 *
 * Anders als pdf.js zeichnet PDFium nicht ueber die Canvas-API, sondern in
 * C++ in einen eigenen Speicherbereich; herausgereicht wird ein fertiges Bild,
 * das nur noch auf das Canvas gelegt wird. Fuer Vektorzeichnungen mit vielen
 * tausend Linien ist das deutlich schneller - im Pruefstand 11 ms fuer eine
 * Kachel von 896 x 544 Punkten bei Maszstab 16, wo pdf.js einige hundert
 * Millisekunden braucht.
 *
 * Drei Dinge sind beim Umgang mit dem wasm-Speicher zu beachten, und alle drei
 * sind stille Fehlerquellen:
 *
 *  1. `HEAPU8` wird bei jeder Speicheranforderung ersetzt, wenn der Speicher
 *     dabei waechst. Ein festgehaltener Verweis zeigt danach ins Leere. Deshalb
 *     wird er hier nirgends zwischengespeichert.
 *  2. `FPDF_LoadMemDocument` kopiert die Datei *nicht*. Der Zeiger muss leben,
 *     solange das Dokument lebt - und wird erst beim Schlieszen freigegeben.
 *  3. Das Zeichnen laeuft synchron und blockiert dabei die Oberflaeche. Eine
 *     Kachel von 8192 x 3900 Punkten waere ein Bild von 128 MB im wasm-Speicher
 *     und ein spuerbares Stocken. Deshalb wird in Streifen gezeichnet: das hebt
 *     den Speicherbedarf nicht ueber 16 MB, laesst zwischendurch die Oberflaeche
 *     atmen und macht das Abbrechen ueberhaupt erst moeglich.
 */
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium'
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url'
import type { Inhaltsbefund } from './planDiagnose'
import { rechneKachel, type Masze, type Rechteck } from './planAnsicht'
import { Abgebrochen, type Blatt, type Dokument, type Motor, type Zeichnung } from './pdfMotor'

/** FPDF_ANNOT: Anmerkungen mitzeichnen - auf Plaenen stehen dort Stempel. */
const FPDF_ANNOT = 0x01
/**
 * FPDF_REVERSE_BYTE_ORDER: PDFium legt sonst BGRA ab, ein Canvas will RGBA.
 * Mit dieser Flagge entfaellt das Umsortieren von Millionen Bildpunkten in
 * JavaScript - der wasm-Speicher geht unveraendert als ImageData weiter.
 */
const FPDF_REVERSE_BYTE_ORDER = 0x10

/** Objektarten aus fpdf_edit.h. */
const OBJ_TEXT = 1
const OBJ_PATH = 2
const OBJ_IMAGE = 3
const OBJ_FORM = 5

/** Wie tief in ineinandergeschachtelte Form-XObjects hinabgestiegen wird. */
const FORM_TIEFE_MAX = 6

/**
 * Hoechstzahl Bildpunkte je Streifen: 4 Millionen sind 16 MB.
 * Klein genug, damit nichts stockt; grosz genug, dass die Streifen nicht
 * ueberhandnehmen.
 */
const STREIFEN_PUNKTE_MAX = 4_000_000

let modulPromise: Promise<WrappedPdfiumModule> | null = null

/**
 * Laedt PDFium genau einmal je Sitzung.
 *
 * Die wasm-Datei wird ueber den Bundler mitgeliefert und nicht von einem CDN
 * geholt: die Anwendung soll auf der Baustelle auch ohne Netz arbeiten.
 */
function holeModul(): Promise<WrappedPdfiumModule> {
  if (!modulPromise) {
    modulPromise = (async () => {
      const antwort = await fetch(wasmUrl)
      if (!antwort.ok) throw new Error(`PDFium konnte nicht geladen werden (HTTP ${antwort.status})`)
      const wasmBinary = await antwort.arrayBuffer()
      const modul = await init({ wasmBinary })
      modul.PDFiumExt_Init()
      return modul
    })().catch((err: unknown) => {
      // Sonst bliebe ein einmal gescheiterter Ladeversuch fuer immer stehen.
      modulPromise = null
      throw err
    })
  }
  return modulPromise
}

/** Die Fehlernummern aus fpdfview.h, in Klartext. */
function ladefehler(nummer: number): string {
  switch (nummer) {
    case 2:
      return 'Datei nicht lesbar'
    case 3:
      return 'kein gueltiges PDF'
    case 4:
      return 'kennwortgeschuetzt'
    case 5:
      return 'Sicherheitsschema nicht unterstuetzt'
    case 6:
      return 'Seite nicht lesbar'
    default:
      return `Fehler ${nummer}`
  }
}

function machBlatt(
  modul: WrappedPdfiumModule,
  seitenZeiger: number,
  gibFrei: () => void
): Blatt {
  const masze: Masze = {
    breite: modul.FPDF_GetPageWidthF(seitenZeiger),
    hoehe: modul.FPDF_GetPageHeightF(seitenZeiger),
  }

  return {
    masze,
    gibFrei,

    zeichne(
      canvas: HTMLCanvasElement,
      fenster: Rechteck,
      blattMassstab: number,
      massstab: number
    ): Zeichnung {
      const kachel = rechneKachel(fenster, blattMassstab, massstab)
      const kontext = canvas.getContext('2d')
      if (!kontext) {
        return { abbrechen: () => {}, fertig: Promise.reject(new Error('kein 2D-Kontext')) }
      }
      // Ausdruecklich noch einmal festgehalten: die Verengung auf "nicht null"
      // reicht sonst nicht in die Closure hinein, die weiter unten zeichnet.
      const ziel: CanvasRenderingContext2D = kontext

      canvas.width = kachel.breite
      canvas.height = kachel.hoehe

      let abgebrochen = false

      // Die ganze Seite in Bildpunkten - PDFium beschneidet selbst auf das
      // Bitmap, es wird also nur der Streifen wirklich gerastert.
      const seiteBreitePx = Math.round(masze.breite * kachel.seitenMassstab)
      const seiteHoehePx = Math.round(masze.hoehe * kachel.seitenMassstab)

      const streifenHoehe = Math.max(
        1,
        Math.min(kachel.hoehe, Math.floor(STREIFEN_PUNKTE_MAX / kachel.breite))
      )

      async function zeichneStreifen(): Promise<void> {
        const bitmap = modul.FPDFBitmap_Create(kachel.breite, streifenHoehe, 1)
        if (!bitmap) throw new Error('PDFium: Bildspeicher konnte nicht angelegt werden')
        try {
          for (let oben = 0; oben < kachel.hoehe; oben += streifenHoehe) {
            // Vor jedem Streifen abgeben, auch vor dem ersten.
            //
            // Ohne diese Zeile lief die gesamte Zeichnung noch *innerhalb* des
            // Aufrufs von `zeichne`, weil eine async-Funktion bis zum ersten
            // await synchron durchlaeuft. Zwei Folgen, beide unsichtbar:
            // `abbrechen` konnte nie greifen, und die Dauer wurde ausserhalb
            // gemessen und stand deshalb im Infofenster mit 0 ms - genau die
            // Art stiller Falschmessung, die eine Fehlersuche in die Irre
            // fuehrt.
            await new Promise((weiter) => window.setTimeout(weiter, 0))
            if (abgebrochen) throw new Abgebrochen()
            const zeilen = Math.min(streifenHoehe, kachel.hoehe - oben)

            // Deckend weisz fuellen: darauf wird gezeichnet, und ohne das
            // stuende in den unbeschriebenen Punkten die Alphastufe 0 - das
            // Canvas waere durchsichtig statt weisz.
            modul.FPDFBitmap_FillRect(bitmap, 0, 0, kachel.breite, streifenHoehe, 0xffffffff)
            modul.FPDF_RenderPageBitmap(
              bitmap,
              seitenZeiger,
              Math.round(kachel.versatzX),
              Math.round(kachel.versatzY) - oben,
              seiteBreitePx,
              seiteHoehePx,
              0,
              FPDF_ANNOT | FPDF_REVERSE_BYTE_ORDER
            )

            if (abgebrochen) throw new Abgebrochen()

            const zeiger = modul.FPDFBitmap_GetBuffer(bitmap)
            const schritt = modul.FPDFBitmap_GetStride(bitmap)
            // Absichtlich eine Kopie und kein Blick in den wasm-Speicher:
            // waechst der Speicher waehrenddessen, wird der alte Puffer
            // abgehaengt und ein Verweis darauf ist ungueltig.
            const roh = new Uint8ClampedArray(
              modul.pdfium.HEAPU8.subarray(zeiger, zeiger + schritt * zeilen)
            )

            if (schritt === kachel.breite * 4) {
              ziel.putImageData(new ImageData(roh, kachel.breite, zeilen), 0, oben)
            } else {
              // Sollte bei einem selbst angelegten Bitmap nicht vorkommen -
              // aber ein stillschweigend verschobenes Bild waere genau die Art
              // Fehler, die als "unscharf" gemeldet wird.
              const eng = new Uint8ClampedArray(kachel.breite * zeilen * 4)
              for (let y = 0; y < zeilen; y++) {
                eng.set(
                  roh.subarray(y * schritt, y * schritt + kachel.breite * 4),
                  y * kachel.breite * 4
                )
              }
              ziel.putImageData(new ImageData(eng, kachel.breite, zeilen), 0, oben)
            }

          }
        } finally {
          modul.FPDFBitmap_Destroy(bitmap)
        }
      }

      return {
        abbrechen: () => {
          abgebrochen = true
        },
        fertig: zeichneStreifen(),
      }
    },
  }
}

/**
 * Woraus die Seite besteht - hier ueber die Seitenobjekte selbst.
 *
 * Das ist die verlaesslichere Auskunft: PDFium nennt Art und Bildaufloesung
 * unmittelbar, waehrend bei pdf.js die Zeichenbefehle nachgezaehlt werden
 * muessen. In Form-XObjects wird hinabgestiegen - CAD-Ausgaben verpacken den
 * Planinhalt regelmaeszig darin, und ohne den Abstieg saehe die Seite leer aus.
 */
function untersucheSeite(
  modul: WrappedPdfiumModule,
  seitenZeiger: number,
  masze: Masze
): Inhaltsbefund {
  let bilder = 0
  let pfade = 0
  let textstellen = 0
  const groessen: Masze[] = []

  // Zwei ganze Zahlen als Rueckgabeplatz fuer die Bildmasze.
  const paar = modul.pdfium.wasmExports.malloc(8)

  const merkeBild = (objekt: number) => {
    if (!paar) return
    modul.pdfium.setValue(paar, 0, 'i32')
    modul.pdfium.setValue(paar + 4, 0, 'i32')
    if (!modul.FPDFImageObj_GetImagePixelSize(objekt, paar, paar + 4)) return
    const breite = modul.pdfium.getValue(paar, 'i32')
    const hoehe = modul.pdfium.getValue(paar + 4, 'i32')
    if (breite > 0 && hoehe > 0) groessen.push({ breite, hoehe })
  }

  const gehe = (objekt: number, tiefe: number): void => {
    const art = modul.FPDFPageObj_GetType(objekt)
    if (art === OBJ_TEXT) {
      textstellen++
    } else if (art === OBJ_PATH) {
      pfade++
    } else if (art === OBJ_IMAGE) {
      bilder++
      merkeBild(objekt)
    } else if (art === OBJ_FORM && tiefe < FORM_TIEFE_MAX) {
      const anzahl = modul.FPDFFormObj_CountObjects(objekt)
      for (let i = 0; i < anzahl; i++) {
        const kind = modul.FPDFFormObj_GetObject(objekt, i)
        if (kind) gehe(kind, tiefe + 1)
      }
    }
  }

  try {
    const anzahl = modul.FPDFPage_CountObjects(seitenZeiger)
    for (let i = 0; i < anzahl; i++) {
      const objekt = modul.FPDFPage_GetObject(seitenZeiger, i)
      if (objekt) gehe(objekt, 0)
    }
  } finally {
    if (paar) modul.pdfium.wasmExports.free(paar)
  }

  const zollBreite = masze.breite / 72
  const bild = groessen.reduce<Masze | null>(
    (groesstes, m) => (!groesstes || m.breite > groesstes.breite ? m : groesstes),
    null
  )
  return {
    bilder,
    pfade,
    textstellen,
    groesstesBild: bild,
    dpi: bild && zollBreite > 0 ? bild.breite / zollBreite : null,
  }
}

export const motorPdfium: Motor = {
  kennung: 'pdfium',
  name: 'PDFium',

  async oeffne(url: string, kopfzeilen?: Record<string, string>): Promise<Dokument> {
    const modul = await holeModul()

    // PDFium liest aus dem Speicher, nicht aus dem Netz - die Datei muss also
    // vorher ganz da sein. pdf.js kann das stueckweise; das ist der eine Punkt,
    // an dem der andere Motor im Vorteil ist.
    const antwort = await fetch(url, { headers: kopfzeilen })
    if (!antwort.ok) throw new Error(`PDF nicht abrufbar (HTTP ${antwort.status})`)
    const bytes = new Uint8Array(await antwort.arrayBuffer())

    const dateiZeiger = modul.pdfium.wasmExports.malloc(bytes.length)
    if (!dateiZeiger) throw new Error('PDFium: kein Speicher fuer die Datei')
    modul.pdfium.HEAPU8.set(bytes, dateiZeiger)

    const dokZeiger = modul.FPDF_LoadMemDocument(dateiZeiger, bytes.length, '')
    if (!dokZeiger) {
      modul.pdfium.wasmExports.free(dateiZeiger)
      throw new Error(`PDFium: ${ladefehler(modul.FPDF_GetLastError())}`)
    }

    /** Offene Seiten, damit beim Schlieszen keine haengenbleibt. */
    const offen = new Set<number>()
    let geschlossen = false

    return {
      seitenzahl: modul.FPDF_GetPageCount(dokZeiger),

      blatt(nummer: number): Promise<Blatt> {
        const seitenZeiger = modul.FPDF_LoadPage(dokZeiger, nummer - 1)
        if (!seitenZeiger) {
          return Promise.reject(new Error(`PDFium: Seite ${nummer} nicht lesbar`))
        }
        offen.add(seitenZeiger)
        return Promise.resolve(
          machBlatt(modul, seitenZeiger, () => {
            // Ueber das Verzeichnis, damit ein zweiter Aufruf - oder ein
            // Schlieszen des Dokuments davor - die Seite nicht doppelt schliesst.
            if (offen.delete(seitenZeiger)) modul.FPDF_ClosePage(seitenZeiger)
          })
        )
      },

      untersuche(nummer: number): Promise<Inhaltsbefund | null> {
        const seitenZeiger = modul.FPDF_LoadPage(dokZeiger, nummer - 1)
        if (!seitenZeiger) return Promise.resolve(null)
        try {
          const masze: Masze = {
            breite: modul.FPDF_GetPageWidthF(seitenZeiger),
            hoehe: modul.FPDF_GetPageHeightF(seitenZeiger),
          }
          return Promise.resolve(untersucheSeite(modul, seitenZeiger, masze))
        } finally {
          modul.FPDF_ClosePage(seitenZeiger)
        }
      },

      schliesse(): Promise<void> {
        if (geschlossen) return Promise.resolve()
        geschlossen = true
        // Reihenfolge zaehlt: erst die Seiten, dann das Dokument, zuletzt der
        // Speicher der Datei - andersherum liest PDFium aus freigegebenem
        // Speicher.
        for (const seitenZeiger of offen) modul.FPDF_ClosePage(seitenZeiger)
        offen.clear()
        modul.FPDF_CloseDocument(dokZeiger)
        modul.pdfium.wasmExports.free(dateiZeiger)
        return Promise.resolve()
      },
    }
  },
}
