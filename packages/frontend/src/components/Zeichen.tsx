/**
 * Der Symbolsatz der Oberflaeche.
 *
 * Vorher mischten sich zwei Welten: Farb-Emoji (🗑 📁 📄 🏠) und Strichzeichen
 * (✕ ✏ ⚙ ⬇). Das sah nicht nur uneinheitlich aus, es hatte eine handfeste
 * Folge: Emoji werden aus der Emoji-Schrift des Systems gezeichnet und
 * ignorieren `color` vollstaendig. Auf dem dunklen Grund der Seitenleiste blieb
 * der Papierkorb deshalb sichtbar, waehrend Stift und Plus im zu dunklen
 * Textton verschwanden - genau die gemeldete Beobachtung.
 *
 * Hier stattdessen eingebettete Pfade: eine Strichstaerke, eine Groesze, Farbe
 * ueber `currentColor`. Damit folgt jedes Zeichen der Umgebung, in der es
 * steht. Eine Symbolschrift oder eine Bibliothek waere fuer gut zwanzig
 * Zeichen mehr Gewicht und im Offlinebetrieb eine Datei mehr, die fehlen kann.
 *
 * Heiszt bewusst nicht "Symbol": das ist der Name eines eingebauten
 * JavaScript-Objekts, und ein Import gleichen Namens wuerde es in jeder Datei
 * verdecken, die ihn einbindet.
 *
 * NICHT hierher gehoeren die Kategoriezeichen auf den Pins - die waehlt der
 * Nutzer selbst, das sind Daten und keine Oberflaeche.
 */

const PFADE = {
  bearbeiten: 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z',
  loeschen: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6M10 11v6M14 11v6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  schliessen: 'M18 6 6 18M6 6l12 12',
  ordner: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  datei: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8ZM14 3v5h5',
  haus: 'M3 11l9-8 9 8M6 10v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V10',
  liste: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  bild: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM21 16l-5-5-9 9M9.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z',
  anhang: 'M21.4 11 12.2 20.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.9-2.9l8.5-8.5',
  einstellungen: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  herunterladen: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  menue: 'M3 6h18M3 12h18M3 18h18',
  post: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM3.5 7.5l8.5 6 8.5-6',
  'chevron-links': 'M15 5l-7 7 7 7',
  'chevron-rechts': 'M9 5l7 7-7 7',
  'chevron-unten': 'M5 9l7 7 7-7',
  'chevron-oben': 'M5 15l7-7 7 7',
  'pfeil-hoch': 'M12 20V5M6 11l6-6 6 6',
  'pfeil-runter': 'M12 4v15M6 13l6 6 6-6',
  einpassen: 'M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3',
} as const

export type ZeichenName = keyof typeof PFADE

interface ZeichenProps {
  name: ZeichenName
  /** Kantenlaenge in Pixeln. 16 passt zur Grundschrift, 14 in dichte Zeilen. */
  groesse?: number
  className?: string
}

export function Zeichen({ name, groesse = 16, className }: ZeichenProps) {
  return (
    <svg
      className={className}
      width={groesse}
      height={groesse}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Die Bedeutung steht im title bzw. aria-label des Knopfes darum herum.
      // Ein zusaetzlich vorgelesenes Zeichen waere nur Laerm.
      aria-hidden="true"
      focusable="false"
      // inline-block statt block: so sitzt das Zeichen sowohl in einer
      // Flex-Zeile richtig als auch mitten im flieszenden Text. Die kleine
      // Absenkung bringt es auf die Mittellinie der Schrift daneben.
      style={{ display: 'inline-block', verticalAlign: '-0.15em', flexShrink: 0 }}
    >
      <path d={PFADE[name]} />
    </svg>
  )
}
