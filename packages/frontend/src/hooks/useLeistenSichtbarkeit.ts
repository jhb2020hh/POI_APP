import { useEffect, useState } from 'react'

/**
 * Sichtbarkeit einer Seitenleiste - am Rechner gemerkt, am Smartphone nicht.
 *
 * Ein einziger Begriff für beide Bildschirmgrößen: „sichtbar" heißt am Rechner
 * ausgeklappt und am Smartphone eingeblendet. Vorher galt das Gegenteil
 * (`ist-offen` wirkte nur mobil), sodass für dieselbe Frage zwei Zustände
 * nötig gewesen wären.
 *
 * Die Vorgabe hängt von der Bildschirmbreite ab: am Rechner ist eine Leiste
 * zunächst da, am Smartphone liegt sie über dem Inhalt und wäre im Weg.
 * Deshalb wird dort auch nichts gemerkt — sonst startete die App mit einer
 * Leiste über der halben Zeichnung.
 */

const MOBIL_ABFRAGE = '(max-width: 768px)'

export function istSchmalerBildschirm(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MOBIL_ABFRAGE).matches
}

/** localStorage ist im privaten Modus mancher Browser gesperrt. */
function lies(schluessel: string): string | null {
  try {
    return localStorage.getItem(schluessel)
  } catch {
    return null
  }
}

function schreibe(schluessel: string, wert: string): void {
  try {
    localStorage.setItem(schluessel, wert)
  } catch {
    /* Ohne Speicher gilt die Einstellung eben nur für diese Sitzung. */
  }
}

export function useLeistenSichtbarkeit(
  schluessel: string
): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [sichtbar, setSichtbar] = useState(() => {
    if (istSchmalerBildschirm()) return false
    return lies(schluessel) !== 'verborgen'
  })

  useEffect(() => {
    if (istSchmalerBildschirm()) return
    schreibe(schluessel, sichtbar ? 'sichtbar' : 'verborgen')
  }, [schluessel, sichtbar])

  return [sichtbar, setSichtbar]
}
