/**
 * Messwerte der Planansicht - Form, Verlauf und Aufbereitung als Text.
 *
 * Der Anlass ist konkret: eine gemeldete Unschaerfe liesz sich zweimal nicht
 * beheben, weil eine Frage unbeantwortet blieb - *passiert ueberhaupt etwas?*
 * Ein unscharfer Plan sieht gleich aus, ob nun gar nicht gezeichnet wurde, zu
 * grob gezeichnet wurde oder das fertige Bild an der falschen Stelle liegt.
 * Von auszen sind die drei Faelle nicht zu unterscheiden.
 *
 * Bewusst hier und nicht im Baustein: so laesst sich die Aufbereitung ohne
 * Browser pruefen, und der Baustein bleibt ein Baustein.
 */

export const VERLAUF_LAENGE = 12

export interface Verlaufseintrag {
  zeit: number
  was: 'geplant' | 'uebersprungen' | 'gezeichnet' | 'abgebrochen' | 'fehlgeschlagen' | 'geladen'
  text: string
  /** Wie oft derselbe Eintrag unmittelbar hintereinander kam. */
  anzahl: number
}

/**
 * Ringpuffer: aeltestes faellt heraus, sobald die Laenge erreicht ist.
 *
 * Gleiche Eintraege unmittelbar hintereinander werden zusammengefasst statt
 * angehaengt. Ohne das fuellt ein einziger Zoomvorgang - vierzig Radereignisse,
 * vierzig Mal "geplant" mit identischem Text - den ganzen Puffer und draengt
 * genau die Zeilen heraus, wegen derer er da ist.
 */
export function schreibeVerlauf(
  puffer: Verlaufseintrag[],
  was: Verlaufseintrag['was'],
  text: string,
  jetzt: number
): void {
  const letzter = puffer[puffer.length - 1]
  if (letzter && letzter.was === was && letzter.text === text) {
    letzter.anzahl++
    letzter.zeit = jetzt
    return
  }
  puffer.push({ zeit: jetzt, was, text, anzahl: 1 })
  while (puffer.length > VERLAUF_LAENGE) puffer.shift()
}

export interface Masze {
  breite: number
  hoehe: number
}

/**
 * Woraus die Seite besteht.
 *
 * Die Frage, die damit beantwortet wird: liegt in der PDF eine Zeichnung aus
 * Linien und Text - dann laesst sie sich in jedem Maszstab scharf zeichnen -
 * oder ein Rasterbild fester Aufloesung? Im zweiten Fall ist ab einem
 * bestimmten Zoom schlicht keine weitere Bildinformation vorhanden, und *kein*
 * Betrachter kann daran etwas aendern. Von auszen sehen beide Faelle beim
 * Hineinzoomen gleich aus.
 */
export interface Inhaltsbefund {
  bilder: number
  pfade: number
  textstellen: number
  groesstesBild: Masze | null
  /** Bildpunkte je Zoll, bezogen auf die Seitenbreite. */
  dpi: number | null
}

/**
 * Wie weit ein Rasterbild bei der aktuellen Vergroeszerung gedehnt wird.
 * Werte ueber 1 heiszen: es wird mehr Bildinformation verlangt als vorhanden.
 */
export function bilddehnung(befund: Inhaltsbefund | null, dpiGezeichnet: number): number | null {
  if (!befund?.dpi || befund.dpi <= 0) return null
  return dpiGezeichnet / befund.dpi
}

export interface PlanDiagnose {
  stand: string
  gebaut: string
  inhalt: Inhaltsbefund | null
  seite: Masze | null
  einpass: number | null
  zoom: number
  /** Obergrenze des Zooms - haengt am Einpassmaszstab, siehe berechneZoomMax. */
  zoomMax: number | null
  verschiebung: { x: number; y: number }
  flaeche: Masze | null
  punktdichte: number
  grundBitmap: Masze | null
  scharf: {
    sichtbar: boolean
    fenster: { x: number; y: number; breite: number; hoehe: number } | null
    bitmap: Masze | null
    massstab: number | null
    benoetigt: number | null
    letzteDauerMs: number | null
  }
  fehler: string | null
  verlauf: Verlaufseintrag[]
}

function zahl(wert: number | null | undefined, stellen = 2): string {
  return wert === null || wert === undefined ? '–' : wert.toFixed(stellen)
}

function masze(m: Masze | null, stellen = 0): string {
  return m ? `${m.breite.toFixed(stellen)} × ${m.hoehe.toFixed(stellen)}` : '–'
}

/**
 * Deckt die vorhandene Aufloesung, was der Zoom braucht?
 *
 * Das ist die eine Zahl, an der der Fall haengt. Stimmt sie, wird punktgenau
 * gezeichnet und die Unschaerfe hat eine ganz andere Ursache.
 */
export function aufloesungPasst(d: PlanDiagnose): boolean {
  const { massstab, benoetigt } = d.scharf
  if (massstab === null || benoetigt === null) return false
  return massstab >= benoetigt * 0.98
}

/**
 * Bildpunkte je Zoll, in denen der sichtbare Ausschnitt gerade gezeichnet wird.
 * 72 pt sind ein Zoll; `massstab` zaehlt Bildpunkte je Buehnenpunkt.
 */
export function gezeichneteDpi(d: PlanDiagnose): number | null {
  if (!d.einpass || d.scharf.massstab === null) return null
  return d.einpass * d.scharf.massstab * 72
}

function inhaltsZeilen(d: PlanDiagnose): string[] {
  if (!d.inhalt) return ['Inhalt       (noch nicht untersucht)']
  const i = d.inhalt
  const zeilen = [
    `Inhalt       ${i.pfade} Linienzüge · ${i.textstellen} Textstellen · ${i.bilder} Bilder`,
  ]
  if (i.bilder > 0 && i.groesstesBild) {
    zeilen.push(
      `             größtes Bild ${masze(i.groesstesBild)} px = ${i.dpi?.toFixed(0) ?? '?'} dpi`
    )
    const gez = gezeichneteDpi(d)
    const dehnung = gez === null ? null : bilddehnung(i, gez)
    if (gez !== null) {
      zeilen.push(
        `             gezeichnet in ${gez.toFixed(0)} dpi` +
          (dehnung === null ? '' : ` → Bild ${dehnung.toFixed(1)}× gedehnt`)
      )
    }
  }
  return zeilen
}

/**
 * Baut den Text, den der Nutzer kopiert und weitergibt.
 *
 * Reiner Text mit fester Spaltenbreite: er soll sich in eine Nachricht
 * einfuegen lassen, ohne unterwegs die Form zu verlieren.
 */
export function alsText(d: PlanDiagnose, jetzt: number): string {
  const zeilen = [
    `Stand        ${d.stand} · ${d.gebaut}`,
    `Browser      Punktdichte ${d.punktdichte} · Fläche ${masze(d.flaeche)}`,
    `Seite        ${masze(d.seite)} pt · Einpassmaßstab ${zahl(d.einpass, 4)}`,
    // Beide Zaehlweisen nebeneinander: `zoom` zaehlt in Vielfachen des
    // Einpassens, die Anzeige in natuerlicher Groesze. Dass beide einmal
    // "800 %" hieszen und Verschiedenes meinten, hat eine Fehlersuche gekostet.
    `Ansicht      ${
      d.einpass ? `${(d.zoom * d.einpass * 100).toFixed(0)} % natürliche Größe` : '–'
    } (Zoom ${zahl(d.zoom)} × Einpassmaßstab)`,
    `             Verschiebung ${d.verschiebung.x.toFixed(0)} / ${d.verschiebung.y.toFixed(0)}${
      d.zoomMax ? ` · Obergrenze ${(d.zoomMax * (d.einpass ?? 1) * 100).toFixed(0)} %` : ''
    }`,
    '',
    ...inhaltsZeilen(d),
    '',
    `Grundebene   Bitmap ${masze(d.grundBitmap)}`,
    `Scharfebene  sichtbar: ${d.scharf.sichtbar ? 'ja' : 'NEIN'}`,
    `             Fenster  ${
      d.scharf.fenster
        ? `${masze(d.scharf.fenster, 1)} bei ${d.scharf.fenster.x.toFixed(1)} / ${d.scharf.fenster.y.toFixed(1)}`
        : '–'
    }`,
    `             Bitmap   ${masze(d.scharf.bitmap)}`,
    `             Maßstab  ${zahl(d.scharf.massstab)} · benötigt ${zahl(d.scharf.benoetigt)}`,
    `             letzte Zeichnung ${d.scharf.letzteDauerMs === null ? '–' : `${d.scharf.letzteDauerMs} ms`}`,
    `Fehler       ${d.fehler ?? 'keiner'}`,
    '',
    'Verlauf (neueste zuerst)',
  ]

  if (d.verlauf.length === 0) {
    zeilen.push('  (leer – es wurde nichts entschieden)')
  } else {
    for (const e of [...d.verlauf].reverse()) {
      const alter = ((jetzt - e.zeit) / 1000).toFixed(1)
      const oft = e.anzahl > 1 ? ` (${e.anzahl}×)` : ''
      zeilen.push(`  -${alter.padStart(6)} s  ${e.was.padEnd(14)} ${e.text}${oft}`)
    }
  }
  return zeilen.join('\n')
}
