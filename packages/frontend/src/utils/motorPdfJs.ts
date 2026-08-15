/**
 * pdf.js hinter der Motor-Schnittstelle.
 *
 * Inhaltlich der Code, der bis hierher unmittelbar im Betrachter stand - nur
 * herausgeloest. Er bleibt als zweite Meinung erhalten: laesst sich derselbe
 * Plan mit dem einen Motor scharf zeichnen und mit dem anderen nicht, liegt es
 * am Motor; sehen beide gleich aus, liegt es an der Datei.
 */
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { Inhaltsbefund } from './planDiagnose'
import { rechneKachel, type Masze, type Rechteck } from './planAnsicht'
import { Abgebrochen, type Blatt, type Dokument, type Motor, type Zeichnung } from './pdfMotor'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

/**
 * Sieht nach, woraus die Seite besteht.
 *
 * pdf.js hat dafuer keine fertige Auskunft; hier werden die Zeichenbefehle der
 * Seite durchgegangen und gezaehlt. Die Bildmasze sind ein Zusatz und nicht
 * immer zu bekommen - die Aussage, *ob* die Zeichnung aus Bildern besteht,
 * steht davon unabhaengig fest.
 */
async function untersucheSeite(page: PDFPageProxy, seite: Masze): Promise<Inhaltsbefund> {
  const liste = await page.getOperatorList()
  const OPS = pdfjsLib.OPS

  let bilder = 0
  let pfade = 0
  let textstellen = 0
  // Als Liste und nicht als laufendes Maximum: eine Zuweisung aus einer
  // Closure heraus verengt TypeScript sonst zu `never`.
  const groessen: Masze[] = []

  function merkeBild(obj: unknown) {
    const b = obj as { width?: number; height?: number } | undefined
    if (!b?.width || !b.height) return
    groessen.push({ breite: b.width, hoehe: b.height })
  }

  /**
   * Bilder liegen in zwei Speichern: gemeinsam genutzte unter "g_..." in
   * `commonObjs`, seitenbezogene in `objs`. Ob die Daten dort stehen, haengt
   * davon ab, wann zuletzt gezeichnet wurde - deshalb der Rueckruf mit kurzer
   * Frist statt eines geradlinigen Zugriffs, der sonst wirft.
   */
  function holeBild(id: string): Promise<unknown> {
    const speicher = id.startsWith('g_') ? page.commonObjs : page.objs
    if (speicher.has(id)) {
      try {
        return Promise.resolve(speicher.get(id))
      } catch {
        return Promise.resolve(undefined)
      }
    }
    return new Promise((fertig) => {
      const frist = window.setTimeout(() => fertig(undefined), 400)
      try {
        speicher.get(id, (daten: unknown) => {
          window.clearTimeout(frist)
          fertig(daten)
        })
      } catch {
        window.clearTimeout(frist)
        fertig(undefined)
      }
    })
  }

  for (let i = 0; i < liste.fnArray.length; i++) {
    const fn = liste.fnArray[i]
    if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
      bilder++
      merkeBild(await holeBild(liste.argsArray[i][0] as string))
    } else if (fn === OPS.paintInlineImageXObject) {
      bilder++
      merkeBild(liste.argsArray[i][0])
    } else if (fn === OPS.constructPath) {
      pfade++
    } else if (fn === OPS.showText) {
      textstellen++
    }
  }

  const zollBreite = seite.breite / 72
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

function machBlatt(page: PDFPageProxy): Blatt {
  const grund = page.getViewport({ scale: 1 })
  return {
    masze: { breite: grund.width, hoehe: grund.height },

    zeichne(
      canvas: HTMLCanvasElement,
      fenster: Rechteck,
      blattMassstab: number,
      massstab: number
    ): Zeichnung {
      const kachel = rechneKachel(fenster, blattMassstab, massstab)
      const context = canvas.getContext('2d')
      if (!context) {
        return { abbrechen: () => {}, fertig: Promise.reject(new Error('kein 2D-Kontext')) }
      }

      canvas.width = kachel.breite
      canvas.height = kachel.hoehe

      // `transform` verschiebt die Zeichnung so, dass die linke obere Ecke des
      // Ausschnitts auf dem Canvas bei (0,0) landet. Das ist der Weg, mit dem
      // pdf.js einen Teilbereich zeichnet, ohne die ganze Seite aufzubauen.
      const auftrag = page.render({
        canvasContext: context,
        canvas,
        viewport: page.getViewport({ scale: kachel.seitenMassstab }),
        transform: [1, 0, 0, 1, kachel.versatzX, kachel.versatzY],
      })

      return {
        abbrechen: () => auftrag.cancel(),
        fertig: auftrag.promise.catch((err: unknown) => {
          if ((err as { name?: string })?.name === 'RenderingCancelledException') {
            throw new Abgebrochen()
          }
          throw err
        }),
      }
    },

    gibFrei() {
      page.cleanup()
    },
  }
}

export const motorPdfJs: Motor = {
  kennung: 'pdfjs',
  name: 'pdf.js',

  async oeffne(url: string, kopfzeilen?: Record<string, string>): Promise<Dokument> {
    // Ueber die URL und nicht ueber vorab geholte Bytes: pdf.js kann die Datei
    // stueckweise laden und zeigt die erste Seite, bevor der Rest da ist.
    const auftrag: PDFDocumentLoadingTask = pdfjsLib.getDocument({
      url,
      httpHeaders: kopfzeilen,
    })
    const pdf: PDFDocumentProxy = await auftrag.promise

    return {
      seitenzahl: pdf.numPages,

      async blatt(nummer: number): Promise<Blatt> {
        return machBlatt(await pdf.getPage(nummer))
      },

      async untersuche(nummer: number): Promise<Inhaltsbefund | null> {
        const page = await pdf.getPage(nummer)
        const grund = page.getViewport({ scale: 1 })
        return untersucheSeite(page, { breite: grund.width, hoehe: grund.height })
      },

      async schliesse(): Promise<void> {
        // `destroy` haengt am Ladeauftrag, nicht am Dokument. Ohne diesen
        // Aufruf bleibt bei jedem Planwechsel ein Arbeiter im Speicher zurueck.
        await auftrag.destroy().catch(() => {})
      },
    }
  },
}
