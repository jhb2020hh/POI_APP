/**
 * Liest die Angaben eines Bildes aus der Datei selbst: Auflösung und, sofern
 * die Kamera sie hinterlegt hat, Aufnahmedatum, Kameramodell, Ausrichtung und
 * Aufnahmeort.
 *
 * Warum eine Bibliothek und kein eigener Leser: EXIF steckt in einer
 * TIFF-Struktur mit zwei möglichen Bytereihenfolgen, verschachtelten
 * Verzeichnissen und Herstellererweiterungen. Für sechs Felder ist ein eigener
 * Parser viel Fehlerfläche — `exifr` ist dafür erprobt.
 *
 * Nachgeladen wird sie erst beim ersten Aufruf (`await import`). Das Bündel ist
 * ohnehin groß; solange niemand ein Infofenster öffnet, soll es nicht auch noch
 * wachsen.
 */

export interface Bildangaben {
  breite: number | null
  hoehe: number | null
  /** ISO-Zeichenkette, sofern die Kamera ein Aufnahmedatum hinterlegt hat. */
  aufnahmeZeitpunkt: string | null
  kamera: string | null
  /** EXIF-Ausrichtung 1–8, falls vorhanden. */
  ausrichtung: number | null
  breitengrad: number | null
  laengengrad: number | null
}

const LEER: Bildangaben = {
  breite: null,
  hoehe: null,
  aufnahmeZeitpunkt: null,
  kamera: null,
  ausrichtung: null,
  breitengrad: null,
  laengengrad: null,
}

/** Abmessungen des Bildes - unabhängig davon, ob EXIF vorhanden ist. */
async function leseAbmessungen(blob: Blob): Promise<{ breite: number; hoehe: number } | null> {
  try {
    const bild = await createImageBitmap(blob)
    const masze = { breite: bild.width, hoehe: bild.height }
    // Ohne close() bleibt der entpackte Bildpuffer im Speicher liegen - bei
    // einigen hundert Baustellenfotos ist das erheblich.
    bild.close()
    return masze
  } catch {
    return null
  }
}

function alsText(wert: unknown): string | null {
  if (typeof wert !== 'string') return null
  const sauber = wert.trim()
  return sauber ? sauber : null
}

function alsZahl(wert: unknown): number | null {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : null
}

export async function leseBildangaben(blob: Blob): Promise<Bildangaben> {
  const abmessungen = await leseAbmessungen(blob)
  const angaben: Bildangaben = {
    ...LEER,
    breite: abmessungen?.breite ?? null,
    hoehe: abmessungen?.hoehe ?? null,
  }

  // Nur Bilder tragen EXIF; bei einem PDF-Anhang wäre der Versuch vergeblich.
  if (!blob.type.startsWith('image/')) return angaben

  try {
    // Nachgeladen als eigenes Bündel (rund 75 KB), das nur beim ersten
    // Infofenster über die Leitung geht. Es gäbe unter exifr/dist/lite.esm.mjs
    // eine 45-KB-Fassung mit denselben Feldern; sie bräuchte aber einen Alias
    // im Build, weil ihr die Typdeklarationen fehlen. Falls die 30 KB einmal
    // zählen, ist das der Hebel.
    const exifr = await import('exifr')
    const roh = (await exifr.parse(blob, {
      // gps: true zieht die Ortsangaben mit heran; ohne die Option lässt exifr
      // sie aus.
      gps: true,
      pick: ['DateTimeOriginal', 'CreateDate', 'Make', 'Model', 'Orientation'],
    })) as Record<string, unknown> | undefined

    if (!roh) return angaben

    // DateTimeOriginal ist der Auslösezeitpunkt, CreateDate der Zeitpunkt, zu
    // dem die Datei entstand. Bei den meisten Kameras identisch; wo nicht, ist
    // der Auslösezeitpunkt der gemeinte.
    const datum = roh.DateTimeOriginal ?? roh.CreateDate
    if (datum instanceof Date && !Number.isNaN(datum.getTime())) {
      angaben.aufnahmeZeitpunkt = datum.toISOString()
    }

    const hersteller = alsText(roh.Make)
    const modell = alsText(roh.Model)
    // Viele Kameras schreiben den Hersteller auch in den Modellnamen
    // ("Apple" + "Apple iPhone 15") - das doppelt sonst in der Anzeige.
    if (modell && hersteller && modell.toLowerCase().startsWith(hersteller.toLowerCase())) {
      angaben.kamera = modell
    } else {
      angaben.kamera = [hersteller, modell].filter(Boolean).join(' ') || null
    }

    angaben.ausrichtung = alsZahl(roh.Orientation)
    angaben.breitengrad = alsZahl(roh.latitude)
    angaben.laengengrad = alsZahl(roh.longitude)
  } catch {
    // Ein Bild ohne EXIF ist der Normalfall, kein Fehler - etwa jeder
    // Bildschirmausschnitt. Die Abmessungen stehen trotzdem.
  }

  return angaben
}
