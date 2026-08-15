/**
 * Was die Planansicht von einem PDF-Motor braucht - und sonst nichts.
 *
 * Bis hierher hing der Betrachter unmittelbar an pdf.js: Ladeauftrag,
 * `getPage`, `getViewport`, `RenderTask`, Ausnahmen mit pdf.js-eigenen Namen.
 * Einen zweiten Motor daneben zu stellen hiesze sonst, den halben Baustein ein
 * zweites Mal zu schreiben.
 *
 * Die Schnittstelle ist absichtlich klein. Der Betrachter braucht genau drei
 * Dinge: die Seitengroesze in PDF-Punkten, das Zeichnen eines *Ausschnitts* in
 * frei waehlbarer Aufloesung, und - fuer das Infofenster - die Auskunft, woraus
 * die Seite besteht. Alles Weitere (Textebene, Suche, Formulare) bleibt drauszen,
 * solange es nicht gebraucht wird.
 *
 * Die zwei Umsetzungen:
 *
 *   pdfium  PDFium als WebAssembly - derselbe Motor, den Chrome fuer PDF
 *           benutzt. Zeichnet in C++, ohne Umweg ueber die Canvas-API.
 *   pdfjs   pdf.js von Mozilla - derselbe Motor, den Firefox ausliefert.
 *
 * Beide sind zur Laufzeit umschaltbar. Das ist kein Zierrat: bei einer
 * gemeldeten Unschaerfe ist die Frage "liegt es am Motor oder an der Datei?"
 * damit in zwei Klicks beantwortet statt in zwei Tagen.
 */
import type { Masze, Rechteck } from './planAnsicht'
import type { Inhaltsbefund } from './planDiagnose'

export type MotorKennung = 'pdfium' | 'pdfjs'

export const MOTOR_KENNUNGEN: readonly MotorKennung[] = ['pdfium', 'pdfjs']

export const MOTOR_NAME: Record<MotorKennung, string> = {
  pdfium: 'PDFium',
  pdfjs: 'pdf.js',
}

/**
 * Abbrueche sind der Normalfall und keine Stoerung: jede Zoombewegung
 * ueberholt die vorige Zeichnung. Die beiden Motoren melden das
 * unterschiedlich - hier bekommt es einen Namen.
 */
export class Abgebrochen extends Error {
  constructor(grund = 'Zeichnung abgebrochen') {
    super(grund)
    this.name = 'Abgebrochen'
  }
}

export function istAbbruch(fehler: unknown): boolean {
  const name = (fehler as { name?: string })?.name
  return name === 'Abgebrochen' || name === 'RenderingCancelledException'
}

export interface Zeichnung {
  /** Wirkt sofort; `fertig` endet danach mit Abgebrochen. */
  abbrechen(): void
  fertig: Promise<void>
}

export interface Blatt {
  /** Seitengroesze in PDF-Punkten (72 pt = ein Zoll). */
  masze: Masze
  /**
   * Zeichnet einen Ausschnitt der Seite auf das Canvas - und setzt dessen
   * Groesze selbst.
   *
   * `fenster` steht in Buehnenkoordinaten: die Seite liegt gedacht in der
   * Groesze `masze * blattMassstab` da, und `fenster` ist der Teil davon, der
   * gebraucht wird. `massstab` sagt, wie viele Bildpunkte auf einen
   * Buehnenpunkt kommen. Das Canvas wird damit
   * `fenster.breite * massstab` mal `fenster.hoehe * massstab` grosz.
   *
   * Die ganze Seite bekommt man mit `fenster = {0, 0, breite*blattMassstab,
   * hoehe*blattMassstab}` - Grund- und Scharfebene benutzen denselben Aufruf.
   */
  zeichne(
    canvas: HTMLCanvasElement,
    fenster: Rechteck,
    blattMassstab: number,
    massstab: number
  ): Zeichnung
  gibFrei(): void
}

export interface Dokument {
  seitenzahl: number
  blatt(nummer: number): Promise<Blatt>
  /**
   * Woraus die Seite besteht - Linien, Text, Bilder.
   *
   * `null`, wenn der Motor darueber nichts sagen kann. Die Frage entscheidet
   * einen Fall, den das Zeichnen nicht beantworten kann: eine zu grob
   * gezeichnete Vektorzeichnung und ein hochskaliertes Rasterbild sehen von
   * auszen gleich aus, verlangen aber entgegengesetzte Antworten.
   */
  untersuche(nummer: number): Promise<Inhaltsbefund | null>
  schliesse(): Promise<void>
}

export interface Motor {
  readonly kennung: MotorKennung
  readonly name: string
  oeffne(url: string, kopfzeilen?: Record<string, string>): Promise<Dokument>
}

/*
 * Die Kachelrechnung selbst steht in planAnsicht.ts - sie ist reine Geometrie
 * und wird dort ohne Browser nachgerechnet (scripts/diagnoseAnsicht.ts).
 */
