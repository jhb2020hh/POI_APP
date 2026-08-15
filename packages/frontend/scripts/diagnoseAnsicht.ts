/**
 * Prueft die Geometrie der Planansicht - ohne Browser.
 *
 * Warum das ueberhaupt geht: die Rechnung steckt in src/utils/planAnsicht.ts
 * und beruehrt das Dokument mit keiner Zeile. Genau dafuer ist sie dort
 * herausgeloest. Der gemeldete Fehler ("der Punkt unter dem Zeiger wandert
 * beim Zoomen weg") ist eine Aussage ueber Zahlen, keine ueber Pixel - er
 * gehoert also hierher und nicht in eine Sichtpruefung.
 *
 *   npm run diagnose:ansicht
 */
import {
  ANSICHT_START,
  CANVAS_FLAECHE_MAX,
  CANVAS_KANTE_MAX,
  DICHTE_MAX,
  VERGROESZERUNG_MAX,
  ZOOM_MIN,
  berechneZoomMax,
  ZOOM_STUFE,
  begrenzeVerschiebung,
  begrenzeZoom,
  berechneEinpassung,
  berechneScharfMassstab,
  berechneSichtfenster,
  geraeteDichte,
  liegtDrin,
  radZuFaktor,
  zoomeAufPunkt,
  type Ansicht,
  type Masze,
} from '../src/utils/planAnsicht'
import {
  VERLAUF_LAENGE,
  alsText,
  schreibeVerlauf,
  type Verlaufseintrag,
} from '../src/utils/planDiagnose'

let allesOk = true

function melde(bedingung: boolean, was: string, abweichung = ''): boolean {
  console.log(`${bedingung ? '  ok  ' : ' FEHL '} ${was}${bedingung ? '' : ` - ${abweichung}`}`)
  if (!bedingung) allesOk = false
  return bedingung
}

/** Rechnet einen Punkt der Flaeche in Buehnenkoordinaten zurueck. */
function inBuehne(ansicht: Ansicht, punkt: { x: number; y: number }) {
  return { x: (punkt.x - ansicht.x) / ansicht.zoom, y: (punkt.y - ansicht.y) / ansicht.zoom }
}

function gleich(a: number, b: number, toleranz = 0.001): boolean {
  return Math.abs(a - b) <= toleranz
}

// A3 quer in PDF-Punkten, und eine Flaeche, wie sie ein Notebook hergibt.
const SEITE: Masze = { breite: 1190.5, hoehe: 842 }
const FLAECHE: Masze = { breite: 1200, hoehe: 700 }

/** Obergrenze fuer die Abschnitte, die sie nicht selbst pruefen. */
const ZOOM_MAX_TEST = 8

console.log('')
console.log('1. Einpassen')

const einpass = berechneEinpassung(SEITE, FLAECHE)
melde(einpass !== null, 'Einpassmaszstab wird ermittelt')
if (einpass !== null) {
  const breite = SEITE.breite * einpass
  const hoehe = SEITE.hoehe * einpass
  melde(
    breite <= FLAECHE.breite && hoehe <= FLAECHE.hoehe,
    'eingepasste Seite passt vollstaendig in die Flaeche',
    `${breite.toFixed(1)} x ${hoehe.toFixed(1)} in ${FLAECHE.breite} x ${FLAECHE.hoehe}`
  )
  // Frueher zaehlte nur die Breite - bei Hochformat blieb unten etwas
  // abgeschnitten. Deshalb hier bewusst ein Hochformat als Gegenprobe.
  const hoch = berechneEinpassung({ breite: 842, hoehe: 1190.5 }, FLAECHE)
  melde(
    hoch !== null && 1190.5 * hoch <= FLAECHE.hoehe,
    'Hochformat wird nach der Hoehe eingepasst',
    hoch === null ? 'kein Wert' : `${(1190.5 * hoch).toFixed(1)} > ${FLAECHE.hoehe}`
  )
}
melde(berechneEinpassung({ breite: 0, hoehe: 0 }, FLAECHE) === null, 'Seite ohne Masze ergibt keinen Wert')
melde(
  berechneEinpassung(SEITE, { breite: 0, hoehe: 0 }) === null,
  'Flaeche ohne Masze ergibt keinen Wert'
)

console.log('')
console.log('2. Zoom haelt den Punkt unter dem Zeiger fest')

const ZEIGER = { x: 315, y: 208 }
let stand: Ansicht = { ...ANSICHT_START }
const vorher = inBuehne(stand, ZEIGER)

for (const faktor of [1.25, 1.25, 1.08, 2, 1 / 1.4, 1.9]) {
  stand = zoomeAufPunkt(stand, ZEIGER, faktor, ZOOM_MAX_TEST)
  const jetzt = inBuehne(stand, ZEIGER)
  if (
    !melde(
      gleich(vorher.x, jetzt.x) && gleich(vorher.y, jetzt.y),
      `nach Faktor ${faktor.toFixed(2)} (Zoom ${stand.zoom.toFixed(2)})`,
      `${vorher.x.toFixed(3)}/${vorher.y.toFixed(3)} wurde zu ${jetzt.x.toFixed(3)}/${jetzt.y.toFixed(3)}`
    )
  ) {
    break
  }
}

// Auch an der Obergrenze: der abgeschnittene Rest darf das Bild nicht
// zusaetzlich verschieben. Genau deshalb wird das Verhaeltnis erst *nach* dem
// Begrenzen gebildet.
let anGrenze: Ansicht = { zoom: ZOOM_MAX_TEST, x: -400, y: -260 }
const vorGrenze = inBuehne(anGrenze, ZEIGER)
anGrenze = zoomeAufPunkt(anGrenze, ZEIGER, 4, ZOOM_MAX_TEST)
const nachGrenze = inBuehne(anGrenze, ZEIGER)
melde(anGrenze.zoom === ZOOM_MAX_TEST, 'Obergrenze wird nicht ueberschritten', `${anGrenze.zoom}`)
melde(
  gleich(vorGrenze.x, nachGrenze.x) && gleich(vorGrenze.y, nachGrenze.y),
  'an der Obergrenze verschiebt sich nichts mehr',
  `${vorGrenze.x.toFixed(3)} wurde zu ${nachGrenze.x.toFixed(3)}`
)

console.log('')
console.log('3. Hin und zurueck landet wieder am Anfang')

let hinUndZurueck: Ansicht = { ...ANSICHT_START }
for (let i = 0; i < 10; i++) hinUndZurueck = zoomeAufPunkt(hinUndZurueck, ZEIGER, ZOOM_STUFE, ZOOM_MAX_TEST)
for (let i = 0; i < 10; i++) hinUndZurueck = zoomeAufPunkt(hinUndZurueck, ZEIGER, 1 / ZOOM_STUFE, ZOOM_MAX_TEST)
melde(
  gleich(hinUndZurueck.zoom, 1, 0.0001),
  'zehnmal hinein und wieder heraus ergibt Zoom 1',
  `${hinUndZurueck.zoom}`
)
melde(
  gleich(hinUndZurueck.x, 0, 0.001) && gleich(hinUndZurueck.y, 0, 0.001),
  'und dieselbe Verschiebung',
  `${hinUndZurueck.x.toFixed(4)}/${hinUndZurueck.y.toFixed(4)}`
)

melde(begrenzeZoom(0.2, ZOOM_MAX_TEST) === ZOOM_MIN, 'Untergrenze greift', `${begrenzeZoom(0.2, ZOOM_MAX_TEST)}`)
melde(begrenzeZoom(999, ZOOM_MAX_TEST) === ZOOM_MAX_TEST, 'Obergrenze greift', `${begrenzeZoom(999, ZOOM_MAX_TEST)}`)
melde(begrenzeZoom(Number.NaN, ZOOM_MAX_TEST) === ZOOM_MIN, 'unbrauchbarer Wert faellt auf die Untergrenze')

console.log('')
console.log('4. Der Plan laesst sich nicht aus dem Bild schieben')

// Bewusst aus dem Einpassmaszstab abgeleitet und nicht von Hand gesetzt: bei
// Zoom 1 ist die Buehne per Definition die eingepasste Seite. Ein Wertepaar,
// das dazu nicht passt, kann es zur Laufzeit gar nicht geben.
const buehne: Masze = { breite: SEITE.breite * einpass!, hoehe: SEITE.hoehe * einpass! }

const mittig = begrenzeVerschiebung({ zoom: 1, x: -900, y: 500 }, buehne, FLAECHE)
melde(
  gleich(mittig.x, (FLAECHE.breite - buehne.breite) / 2) &&
    gleich(mittig.y, (FLAECHE.hoehe - buehne.hoehe) / 2),
  'kleiner als die Flaeche: wird mittig gestellt',
  `${mittig.x.toFixed(1)}/${mittig.y.toFixed(1)}`
)

const weitDraussen = begrenzeVerschiebung({ zoom: 4, x: 9000, y: 9000 }, buehne, FLAECHE)
melde(weitDraussen.x <= 0 && weitDraussen.y <= 0, 'nach rechts unten begrenzt', `${weitDraussen.x}/${weitDraussen.y}`)

const weitLinks = begrenzeVerschiebung({ zoom: 4, x: -99999, y: -99999 }, buehne, FLAECHE)
const inhalt = { breite: buehne.breite * 4, hoehe: buehne.hoehe * 4 }
melde(
  gleich(weitLinks.x, FLAECHE.breite - inhalt.breite) &&
    gleich(weitLinks.y, FLAECHE.hoehe - inhalt.hoehe),
  'nach links oben begrenzt: der rechte untere Rand bleibt buendig',
  `${weitLinks.x.toFixed(1)}/${weitLinks.y.toFixed(1)}`
)

console.log('')
console.log('5. Rad und Trackpad')

melde(radZuFaktor(-100) > 1, 'nach oben vergroeszert', `${radZuFaktor(-100).toFixed(3)}`)
melde(radZuFaktor(100) < 1, 'nach unten verkleinert', `${radZuFaktor(100).toFixed(3)}`)
melde(gleich(radZuFaktor(0), 1), 'ohne Ausschlag keine Aenderung')
melde(
  gleich(radZuFaktor(-3) * radZuFaktor(3), 1, 0.0001),
  'gleicher Weg zurueck hebt sich auf',
  `${(radZuFaktor(-3) * radZuFaktor(3)).toFixed(6)}`
)
// Ein Trackpad-Kneifen meldet viele winzige Ausschlaege. Sie muessen sich
// aufsummieren, statt jeweils eine feste Stufe zu springen.
const vieleKleine = Array.from({ length: 10 }, () => radZuFaktor(-3)).reduce((a, b) => a * b, 1)
melde(
  gleich(vieleKleine, radZuFaktor(-30), 0.0001),
  'zehn kleine Schritte entsprechen einem groszen',
  `${vieleKleine.toFixed(4)} statt ${radZuFaktor(-30).toFixed(4)}`
)
// Firefox meldet ueberwiegend Zeilen statt Bildpunkte.
melde(
  gleich(radZuFaktor(-3, 1), radZuFaktor(-48, 0), 0.0001),
  'Zeilenmodus wird umgerechnet',
  `${radZuFaktor(-3, 1).toFixed(4)} statt ${radZuFaktor(-48, 0).toFixed(4)}`
)
melde(radZuFaktor(-5000) === radZuFaktor(-120), 'Ausreiszer werden gedeckelt')

console.log('')
console.log('6. Sichtfenster')

// Ganz herausgezoomt und mittig: das Fenster ist die ganze Seite. Ein Rand
// darueber hinaus waere sinnlos, es gibt dort nichts zu zeichnen.
const ganzeSeite = berechneSichtfenster(
  begrenzeVerschiebung(ANSICHT_START, buehne, FLAECHE),
  buehne,
  FLAECHE
)
melde(
  gleich(ganzeSeite.x, 0) &&
    gleich(ganzeSeite.y, 0) &&
    gleich(ganzeSeite.breite, buehne.breite) &&
    gleich(ganzeSeite.hoehe, buehne.hoehe),
  'bei 100 % umfasst das Fenster genau die Seite',
  `${ganzeSeite.x.toFixed(1)}/${ganzeSeite.y.toFixed(1)} ${ganzeSeite.breite.toFixed(1)}x${ganzeSeite.hoehe.toFixed(1)}`
)

// Hineingezoomt: das Fenster muss kleiner als die Seite werden - sonst waere
// nichts gewonnen und das Bitmap wieder unbezahlbar grosz.
const tief: Ansicht = begrenzeVerschiebung({ zoom: 8, x: -2000, y: -1500 }, buehne, FLAECHE)
const fensterTief = berechneSichtfenster(tief, buehne, FLAECHE)
melde(
  fensterTief.breite < buehne.breite * 0.3 && fensterTief.hoehe < buehne.hoehe * 0.4,
  'bei 800 % deckt das Fenster nur einen kleinen Teil der Seite ab',
  `${fensterTief.breite.toFixed(1)}x${fensterTief.hoehe.toFixed(1)} von ${buehne.breite.toFixed(1)}x${buehne.hoehe.toFixed(1)}`
)

// Das eigentlich Sichtbare muss vollstaendig im gezeichneten Bereich liegen -
// sonst blitzt beim Schwenken ein ungezeichneter Streifen auf.
const sichtbarTief = berechneSichtfenster(tief, buehne, FLAECHE, 0)
melde(
  liegtDrin(sichtbarTief, fensterTief),
  'das Sichtbare liegt vollstaendig im gezeichneten Bereich',
  `${JSON.stringify(sichtbarTief)} nicht in ${JSON.stringify(fensterTief)}`
)

// Und der Rand muss auch etwas bringen: eine kleine Verschiebung darf nicht
// sofort ein Neuzeichnen ausloesen.
const etwasVerschoben = begrenzeVerschiebung({ zoom: 8, x: tief.x - 30, y: tief.y - 30 }, buehne, FLAECHE)
melde(
  liegtDrin(berechneSichtfenster(etwasVerschoben, buehne, FLAECHE, 0), fensterTief),
  'nach 30 Punkten Verschiebung reicht der gezeichnete Bereich noch',
  'der Rand ist zu knapp'
)

// Am Seitenrand darf das Fenster nicht ueber das Blatt hinausragen: ein
// negativer Versatz zeichnete sonst ins Leere.
const amRand = berechneSichtfenster({ zoom: 8, x: 0, y: 0 }, buehne, FLAECHE)
melde(
  amRand.x >= 0 && amRand.y >= 0 && amRand.x + amRand.breite <= buehne.breite + 0.001,
  'am Seitenrand bleibt das Fenster auf dem Blatt',
  `${amRand.x}/${amRand.y} + ${amRand.breite}`
)

console.log('')
console.log('7. Aufloesung des Ausschnitts')

melde(gleich(geraeteDichte(3), DICHTE_MAX), 'ueberhohe Punktdichte wird gedeckelt', `${geraeteDichte(3)}`)
melde(gleich(geraeteDichte(undefined), 1), 'fehlende Punktdichte ergibt 1')
melde(gleich(geraeteDichte(2), 2), 'doppelte Punktdichte bleibt erhalten')

// Der springende Punkt: ein Buehnenpunkt bekommt zoom * dichte Bildpunkte -
// damit entspricht ein Bildpunkt genau einem Geraetepunkt. Frueher wurde die
// ganze Seite gezeichnet und deshalb bei 800 % auf ein Drittel gekuerzt.
for (const zoom of [1, 2, 4, ZOOM_MAX_TEST]) {
  const stelle = begrenzeVerschiebung(
    { zoom, x: -buehne.breite * zoom * 0.3, y: -buehne.hoehe * zoom * 0.3 },
    buehne,
    FLAECHE
  )
  const fenster = berechneSichtfenster(stelle, buehne, FLAECHE)
  const massstab = berechneScharfMassstab(zoom, 2, fenster)
  melde(
    gleich(massstab, zoom * 2, 0.0001),
    `bei ${zoom * 100} % wird punktgenau gezeichnet`,
    `${massstab.toFixed(3)} statt ${(zoom * 2).toFixed(3)}`
  )
  const kante = Math.max(fenster.breite, fenster.hoehe) * massstab
  melde(
    kante <= CANVAS_KANTE_MAX + 0.5 &&
      fenster.breite * massstab * fenster.hoehe * massstab <= CANVAS_FLAECHE_MAX + 1,
    `  und bleibt dabei innerhalb der Browsergrenzen (${Math.round(kante)} px Kante)`,
    `${Math.round(kante)} px`
  )
}

// Gegenprobe: waere das Fenster so grosz wie eine ganze A0-Seite bei 800 %,
// muesste gekuerzt werden. Genau dieser Fall trat vorher bei *jedem* Zoom ein.
const uebergrosz = berechneScharfMassstab(8, 2, { breite: 3370, hoehe: 2384 })
melde(uebergrosz < 16, 'ein uebergroszes Fenster wird gekuerzt statt leer geliefert', `${uebergrosz}`)

console.log('')
console.log('8. Obergrenze des Zooms zaehlt in natuerlicher Groesze')

// Der Fall, an dem es aufgefallen ist: ein Plan von 195 x 84 cm auf einem
// Notebook. Mit einer festen Grenze von 8 kam man auf 132 % natuerliche
// Groesze - in Acrobat stand bei derselben Beschriftung "800 %" das
// Sechsfache. Verglichen wurden zwei voellig verschiedene Vergroeszerungen.
const GROSZER_PLAN: Masze = { breite: 5525, hoehe: 2384 }
const NOTEBOOK: Masze = { breite: 934, hoehe: 595 }
const einpassGrosz = berechneEinpassung(GROSZER_PLAN, NOTEBOOK)!
melde(gleich(einpassGrosz, 0.1647, 0.0005), 'Einpassmaszstab des groszen Plans', `${einpassGrosz}`)

const maxGrosz = berechneZoomMax(einpassGrosz)
melde(
  gleich(maxGrosz * einpassGrosz, VERGROESZERUNG_MAX, 0.01),
  `grosze Seite: Obergrenze erreicht ${VERGROESZERUNG_MAX * 100} % natuerliche Groesze`,
  `${(maxGrosz * einpassGrosz * 100).toFixed(0)} %`
)
melde(maxGrosz > 40, 'und liegt damit deutlich ueber der alten festen 8', `${maxGrosz.toFixed(1)}`)

// Gegenprobe: eine Seite, die ohnehin fast in natuerlicher Groesze dasteht,
// darf dadurch nicht *weniger* Zoom bekommen als vorher.
const einpassA3 = berechneEinpassung(SEITE, FLAECHE)!
melde(
  berechneZoomMax(einpassA3) >= 8,
  'kleine Seite behaelt mindestens das achtfache Einpassen',
  `${berechneZoomMax(einpassA3).toFixed(2)}`
)
melde(berechneZoomMax(null) === 8, 'ohne Einpassmaszstab bleibt es bei 8')
melde(berechneZoomMax(0) === 8, 'ein Einpassmaszstab von null ergibt keine Division durch null')

// Das Entscheidende: mehr Zoom kostet nichts. Das Fenster schrumpft mit
// steigendem Maszstab, das Bitmap bleibt gleich grosz.
const buehneGrosz: Masze = {
  breite: GROSZER_PLAN.breite * einpassGrosz,
  hoehe: GROSZER_PLAN.hoehe * einpassGrosz,
}
let vorigeFlaeche = 0
for (const zoom of [8, 16, 32, maxGrosz]) {
  const a: Ansicht = {
    zoom,
    x: -buehneGrosz.breite * zoom * 0.4,
    y: -buehneGrosz.hoehe * zoom * 0.4,
  }
  const f = berechneSichtfenster(a, buehneGrosz, NOTEBOOK)
  const m = berechneScharfMassstab(zoom, 2, f)
  const bildpunkte = f.breite * m * f.hoehe * m
  if (vorigeFlaeche > 0) {
    melde(
      Math.abs(bildpunkte - vorigeFlaeche) / vorigeFlaeche < 0.02,
      `bei ${(zoom * einpassGrosz * 100).toFixed(0)} % natuerlich bleibt das Bitmap gleich grosz`,
      `${(bildpunkte / 1e6).toFixed(2)} statt ${(vorigeFlaeche / 1e6).toFixed(2)} Megapunkte`
    )
  }
  vorigeFlaeche = bildpunkte
  melde(
    gleich(m, zoom * 2, 0.0001),
    `  und wird bei ${(zoom * einpassGrosz * 100).toFixed(0)} % punktgenau gezeichnet`,
    `${m.toFixed(2)} statt ${(zoom * 2).toFixed(2)}`
  )
}

console.log('')
console.log('9. Verlauf der Zeichenentscheidungen')

// Der Verlauf ist das Werkzeug, mit dem sich "der Plan ist unscharf" in eine
// beantwortbare Frage verwandelt. Wenn er ueberlaeuft oder Wiederholungen
// nicht zusammenfasst, verdraengt ein einziger Zoomvorgang genau die Zeilen,
// wegen derer er da ist.
const puffer: Verlaufseintrag[] = []
for (let i = 0; i < 40; i++) schreibeVerlauf(puffer, 'geplant', 'gleicher Text', 1000 + i)
melde(puffer.length === 1, 'gleiche Eintraege werden zusammengefasst', `${puffer.length} statt 1`)
melde(puffer[0].anzahl === 40, 'die Anzahl wird mitgezaehlt', `${puffer[0].anzahl} statt 40`)
melde(puffer[0].zeit === 1039, 'der Zeitstempel wandert auf den letzten mit', `${puffer[0].zeit}`)

for (let i = 0; i < 40; i++) schreibeVerlauf(puffer, 'gezeichnet', `Lauf ${i}`, 2000 + i)
melde(
  puffer.length === VERLAUF_LAENGE,
  'der Ringpuffer haelt seine Laenge',
  `${puffer.length} statt ${VERLAUF_LAENGE}`
)
melde(
  puffer[puffer.length - 1].text === 'Lauf 39',
  'der neueste Eintrag bleibt erhalten',
  puffer[puffer.length - 1].text
)

const auszug = alsText(
  {
    stand: 'abc1234', gebaut: '15.08.2026',
    seite: { breite: 2384, hoehe: 1684 }, einpass: 0.4964, zoom: 8, zoomMax: 16.1,
    verschiebung: { x: -3054, y: -2613 },
    flaeche: { breite: 1400, hoehe: 860 }, punktdichte: 1,
    grundBitmap: { breite: 1183, hoehe: 836 },
    scharf: {
      sichtbar: true, fenster: { x: 346.7, y: 305.1, breite: 245, hoehe: 150.5 },
      bitmap: { breite: 1960, hoehe: 1204 }, massstab: 8, benoetigt: 8, letzteDauerMs: 42,
    },
    fehler: null, verlauf: puffer,
  },
  2100
)
melde(auszug.includes('Maßstab  8.00 · benötigt 8.00'), 'der Auszug nennt vorhandenen und noetigen Maszstab')
melde(auszug.includes('Lauf 39'), 'der Auszug enthaelt den Verlauf')
melde(!auszug.includes('undefined') && !auszug.includes('NaN'), 'der Auszug enthaelt keine Luecken')

console.log('')
console.log(allesOk ? 'Ergebnis: alles in Ordnung.' : 'Ergebnis: es gibt Abweichungen.')
if (!allesOk) process.exitCode = 1
