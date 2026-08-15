/**
 * Waehlt zwischen den beiden Betrachtern.
 *
 * Es gibt zwei, und das ist Absicht auf Zeit. Eine gemeldete Unschaerfe liesz
 * sich in vier Runden nicht abstellen: die Rechnung des selbstgebauten
 * Betrachters ist ohne Browser geprueft und im Browser gemessen, und trotzdem
 * kam jedes Mal zurueck, dass es unveraendert aussieht. Zwischen meiner
 * Messung und dem, was beim Nutzer ankommt, liegt also etwas, das ich nicht
 * sehe.
 *
 * Statt weiter blind zu reparieren, steht der neue Betrachter (EmbedPDF,
 * PDFium) daneben und ist in einem Klick erreichbar. Der Nutzer beantwortet
 * damit selbst die Frage, an der die Fehlersuche haengt - sieht derselbe
 * Ausschnitt in beiden gleich aus, liegt es nicht am Betrachter, sondern an
 * der Datei.
 *
 * Sobald das entschieden ist, faellt einer von beiden weg und dieser Baustein
 * mit ihm.
 */
import { useState } from 'react'
import type { Category, Point } from '@poi-app/shared'
import { PdfViewer } from './PdfViewer'
import { PlanBetrachter } from './PlanBetrachter'

const SPEICHER = 'poi.planbetrachter'

export type Betrachter = 'neu' | 'alt'

/** Der neue ist die Vorgabe - er ist der Grund fuer den Umbau. */
const VORGABE: Betrachter = 'neu'

function gemerkt(): Betrachter {
  try {
    const wert = window.localStorage.getItem(SPEICHER)
    return wert === 'alt' || wert === 'neu' ? wert : VORGABE
  } catch {
    // Ohne Zugriff auf den Speicher (private Sitzung, gesperrte Einstellung)
    // bleibt es bei der Vorgabe.
    return VORGABE
  }
}

interface PlanAnsichtProps {
  fileUrl: string
  points: Point[]
  categories: Category[]
  selectedPointId?: string
  onCanvasClick: (relX: number, relY: number) => void
  onPointClick: (point: Point) => void
  seitenzahl?: number | null
}

export function PlanAnsicht(props: PlanAnsichtProps) {
  const [betrachter, setBetrachter] = useState<Betrachter>(gemerkt)

  function wechsle() {
    const naechster: Betrachter = betrachter === 'neu' ? 'alt' : 'neu'
    setBetrachter(naechster)
    try {
      window.localStorage.setItem(SPEICHER, naechster)
    } catch {
      // Die Wahl gilt dann nur fuer diese Sitzung.
    }
  }

  return betrachter === 'neu' ? (
    <PlanBetrachter {...props} onBetrachterWechsel={wechsle} />
  ) : (
    <PdfViewer {...props} onBetrachterWechsel={wechsle} />
  )
}
