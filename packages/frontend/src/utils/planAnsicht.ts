/**
 * Die Geometrie der Planansicht - Zoom, Verschiebung, Grenzen.
 *
 * Bewusst ohne jeden Zugriff auf das Dokument: reine Funktionen, die aus einem
 * Zustand einen neuen berechnen. Nur so laesst sich die Rechnung ueberhaupt
 * pruefen (siehe scripts/diagnoseAnsicht.ts) - im Browser waere sie nur von
 * Hand zu beurteilen, und genau dort lag der gemeldete Fehler.
 *
 * Zwei Groessen, die vorher eine waren:
 *
 *   einpassMassstab  Wie viele Bildschirmpunkte ein Punkt der PDF-Seite belegt,
 *                    wenn die ganze Seite sichtbar ist. Aendert sich nur, wenn
 *                    sich die Flaeche aendert.
 *   zoom             Vielfaches davon. 1 = ganze Seite sichtbar. Das ist
 *                    zugleich die Zahl in der Leiste: zoom * 100 Prozent.
 *
 * Vorher trug `scale` beides zugleich und bestimmte nebenbei die Aufloesung des
 * Canvas. Deshalb hing jede Bewegung am Neuzeichnen und die Prozentanzeige
 * ergab je nach Planformat andere Zahlen fuer denselben Anblick.
 */

/** Luft zwischen Seite und Rand, damit der Plan nicht buendig anklebt. */
export const EINPASS_LUFT_PX = 24

export const ZOOM_MIN = 1
export const ZOOM_MAX = 8

/** Stufe eines Tastendrucks oder eines Knopfes in der Leiste. */
export const ZOOM_STUFE = 1.25

export interface Masze {
  breite: number
  hoehe: number
}

/**
 * Verschiebung der Buehne in Bildschirmpunkten, gemessen von der linken oberen
 * Ecke der Flaeche. Zusammen mit `zoom` beschreibt sie den Anblick vollstaendig.
 */
export interface Ansicht {
  zoom: number
  x: number
  y: number
}

export const ANSICHT_START: Ansicht = { zoom: 1, x: 0, y: 0 }

export function begrenzeZoom(wert: number): number {
  if (!Number.isFinite(wert)) return ZOOM_MIN
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, wert))
}

/**
 * Maszstab, bei dem die *ganze* Seite in die Flaeche passt.
 *
 * Maszgeblich ist der kleinere der beiden Faktoren. Nur die Breite zu
 * betrachten liess bei einem Hochformat-Plan unten etwas abgeschnitten.
 * Ist die Hoehe noch nicht bekannt - die Flaeche baut sich gerade erst auf -
 * zaehlt ersatzweise die Breite allein.
 */
export function berechneEinpassung(seite: Masze, flaeche: Masze): number | null {
  if (seite.breite <= 0 || seite.hoehe <= 0) return null

  const breite = flaeche.breite - EINPASS_LUFT_PX
  const hoehe = flaeche.hoehe - EINPASS_LUFT_PX
  if (breite <= 0) return null

  const nachBreite = breite / seite.breite
  const faktor = hoehe > 0 ? Math.min(nachBreite, hoehe / seite.hoehe) : nachBreite
  return Math.max(0.01, Math.round(faktor * 10000) / 10000)
}

/**
 * Zoomt um `faktor` und haelt dabei genau den Punkt fest, auf den gezeigt wird.
 *
 * Das ist der Kern der gemeldeten Beanstandung: vorher aenderte sich nur der
 * Maszstab, und der Punkt unter dem Zeiger wanderte weg.
 *
 * Herleitung - `p` ist der Zeiger in Flaechenkoordinaten, `b` derselbe Punkt in
 * Buehnenkoordinaten:
 *
 *   b  = (p - x) / zoom            vor dem Zoomen
 *   x' = p - b * zoom'             danach, damit derselbe b unter p liegt
 *      = p - (p - x) * zoom'/zoom
 *
 * Das Verhaeltnis `zoom'/zoom` wird nach dem Begrenzen gebildet, nicht davor -
 * sonst schoebe ein an der Grenze abgeschnittener Zoomschritt das Bild trotzdem
 * weiter.
 */
export function zoomeAufPunkt(
  ansicht: Ansicht,
  punkt: { x: number; y: number },
  faktor: number
): Ansicht {
  const neuerZoom = begrenzeZoom(ansicht.zoom * faktor)
  const k = neuerZoom / ansicht.zoom
  return {
    zoom: neuerZoom,
    x: punkt.x - (punkt.x - ansicht.x) * k,
    y: punkt.y - (punkt.y - ansicht.y) * k,
  }
}

/**
 * Haelt die Buehne im Bild.
 *
 * Ist die Seite kleiner als die Flaeche, wird sie mittig gestellt - das ist der
 * Normalfall bei 100 %. Ist sie groesser, darf sie sich bis an die Raender
 * schieben, aber nicht darueber hinaus: sonst schwenkt man den Plan aus dem
 * Fenster und sieht nur noch Grau.
 */
export function begrenzeVerschiebung(
  ansicht: Ansicht,
  seiteEingepasst: Masze,
  flaeche: Masze
): Ansicht {
  const breite = seiteEingepasst.breite * ansicht.zoom
  const hoehe = seiteEingepasst.hoehe * ansicht.zoom

  function achse(wert: number, inhalt: number, sichtbar: number): number {
    if (inhalt <= sichtbar) return (sichtbar - inhalt) / 2
    return Math.min(0, Math.max(sichtbar - inhalt, wert))
  }

  return {
    zoom: ansicht.zoom,
    x: achse(ansicht.x, breite, flaeche.breite),
    y: achse(ansicht.y, hoehe, flaeche.hoehe),
  }
}

/** Ganze Seite sichtbar, mittig. */
export function passeEin(seiteEingepasst: Masze, flaeche: Masze): Ansicht {
  return begrenzeVerschiebung(ANSICHT_START, seiteEingepasst, flaeche)
}

/**
 * Rechnet ein Radereignis in einen Zoomfaktor um.
 *
 * Stufenlos statt fester Schrittweite, und das aus einem handfesten Grund: ein
 * Trackpad-Kneifen liefert viele winzige `deltaY`, ein Mausrad wenige grosze.
 * Beide durch denselben Festwert (frueher 1,08 je Ereignis) zu schicken ergab
 * am Trackpad einen Sprung statt einer Bewegung.
 *
 * `deltaMode` muss mit hinein: Firefox meldet ueberwiegend Zeilen (1) statt
 * Bildpunkte (0), Seiten (2) kommen bei Bild auf/ab vor.
 */
export function radZuFaktor(delta: number, deltaMode = 0): number {
  const inPunkten = delta * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1)
  // Deckel gegen einzelne Ausreiszer, wie sie manche Maustreiber senden -
  // ohne ihn springt ein Tick von 500 auf das Hundertfache.
  const begrenzt = Math.max(-120, Math.min(120, inPunkten))
  return Math.exp(-begrenzt * 0.0075)
}

/**
 * Aufloesung, in der pdf.js zeichnen soll.
 *
 * Beruecksichtigt die Bildpunktdichte des Geraetes - vorher fehlte sie ganz,
 * weshalb der Plan auf jedem heutigen Notebook weich aussah.
 *
 * Der Deckel ist noetig, weil Browser die Kantenlaenge eines Canvas begrenzen.
 * Wird er ueberschritten, liefert pdf.js eine *leere* Flaeche. Deshalb wird
 * lieber der Zeichenmaszstab beschnitten: dann wird die Ansicht bei extremem
 * Zoom weich statt leer.
 */
export const CANVAS_KANTE_MAX = 8192

export function berechneZeichenMassstab(
  seite: Masze,
  einpassMassstab: number,
  zoom: number,
  bildpunktdichte: number
): number {
  const gewuenscht = einpassMassstab * zoom * bildpunktdichte
  const groessereKante = Math.max(seite.breite, seite.hoehe)
  if (groessereKante <= 0) return gewuenscht
  const hoechster = CANVAS_KANTE_MAX / groessereKante
  return Math.min(gewuenscht, hoechster)
}
