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

/* -------------------------------------------------------------------------
   Aufloesung
   -------------------------------------------------------------------------
   Der entscheidende Punkt: gezeichnet wird nicht die ganze Seite, sondern nur
   der sichtbare Ausschnitt.

   Die ganze Seite in voller Aufloesung ginge gar nicht. Ein A1-Plan bei 800 %
   auf einem Bildschirm mit doppelter Punktdichte braeuchte rund 24000 x 17000
   Bildpunkte - vierhundert Millionen, also etwa 1,6 GB. Kein Browser gibt das
   her; er liefert dann eine leere Flaeche. Der frueher hier stehende Deckel
   von 8192 Punkten je Kante verhinderte das zwar, aber um den Preis, dass bei
   starkem Zoom nur noch mit einem Bruchteil der noetigen Aufloesung gezeichnet
   wurde - sichtbar als grobe Kloetzchen.

   Beschraenkt man sich auf den Ausschnitt, faellt das Problem weg: der wird
   nie groeszer als der Bildschirm, egal wie weit man hineinzoomt. Der Bedarf
   bleibt damit *unabhaengig vom Zoom* konstant, und die Darstellung ist bei
   jedem Maszstab punktgenau.
   ------------------------------------------------------------------------- */

/** Ein Ausschnitt der Buehne, in Buehnenkoordinaten. */
export interface Rechteck {
  x: number
  y: number
  breite: number
  hoehe: number
}

/**
 * Mehr als der Bildschirm zeigt, damit kleine Verschiebungen nicht sofort ein
 * Neuzeichnen ausloesen. Anteil der sichtbaren Groesze je Seite.
 */
export const SICHTFENSTER_RAND = 0.2

/**
 * Der Teil der Buehne, der zu sehen ist - mit Rand und auf die Seite begrenzt.
 *
 * Umkehrung der Darstellungsrechnung: ein Punkt p der Flaeche liegt auf der
 * Buehne bei (p - verschiebung) / zoom.
 */
export function berechneSichtfenster(
  ansicht: Ansicht,
  buehne: Masze,
  flaeche: Masze,
  randAnteil = SICHTFENSTER_RAND
): Rechteck {
  const sichtbareBreite = flaeche.breite / ansicht.zoom
  const sichtbareHoehe = flaeche.hoehe / ansicht.zoom
  const linkeKante = -ansicht.x / ansicht.zoom
  const obereKante = -ansicht.y / ansicht.zoom

  const links = Math.max(0, linkeKante - sichtbareBreite * randAnteil)
  const oben = Math.max(0, obereKante - sichtbareHoehe * randAnteil)
  const rechts = Math.min(buehne.breite, linkeKante + sichtbareBreite * (1 + randAnteil))
  const unten = Math.min(buehne.hoehe, obereKante + sichtbareHoehe * (1 + randAnteil))

  return {
    x: links,
    y: oben,
    breite: Math.max(0, rechts - links),
    hoehe: Math.max(0, unten - oben),
  }
}

/** Liegt `innen` vollstaendig in `auszen`? */
export function liegtDrin(innen: Rechteck, auszen: Rechteck, toleranz = 0.5): boolean {
  return (
    innen.x >= auszen.x - toleranz &&
    innen.y >= auszen.y - toleranz &&
    innen.x + innen.breite <= auszen.x + auszen.breite + toleranz &&
    innen.y + innen.hoehe <= auszen.y + auszen.hoehe + toleranz
  )
}

/**
 * Mehr als die doppelte Punktdichte bringt dem Auge nichts mehr, kostet aber
 * das Vierfache an Speicher. Manche Geraete melden 3 oder 4.
 */
export const DICHTE_MAX = 2

export function geraeteDichte(gemeldet: number | undefined): number {
  if (!gemeldet || !Number.isFinite(gemeldet) || gemeldet < 1) return 1
  return Math.min(DICHTE_MAX, gemeldet)
}

/**
 * Grenzen, die Browser fuer ein Canvas setzen. Die Flaechengrenze ist die
 * wirksamere: 32 Millionen Punkte sind rund 128 MB. Beide greifen bei der
 * Ausschnittzeichnung praktisch nie - sie stehen als Sicherung fuer sehr
 * grosze Bildschirme.
 */
export const CANVAS_KANTE_MAX = 8192
export const CANVAS_FLAECHE_MAX = 32_000_000

/**
 * Bildpunkte des Canvas je Buehnenpunkt.
 *
 * Angestrebt wird `zoom * dichte`: dann entspricht ein Bildpunkt des Canvas
 * genau einem Bildpunkt des Geraets. Nur wenn das die Grenzen sprengt, wird
 * gekuerzt - dann ist die Ansicht weich statt leer.
 */
export function berechneScharfMassstab(
  zoom: number,
  dichte: number,
  fenster: Masze
): number {
  const gewuenscht = zoom * dichte
  if (fenster.breite <= 0 || fenster.hoehe <= 0) return gewuenscht
  const nachKante = CANVAS_KANTE_MAX / Math.max(fenster.breite, fenster.hoehe)
  const nachFlaeche = Math.sqrt(CANVAS_FLAECHE_MAX / (fenster.breite * fenster.hoehe))
  return Math.min(gewuenscht, nachKante, nachFlaeche)
}
