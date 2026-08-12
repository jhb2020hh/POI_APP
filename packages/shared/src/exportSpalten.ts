/**
 * Welche Angaben eines Tickets sich ausgeben lassen.
 *
 * Gemeinsam genutzt: das Backend baut daraus die Spalten der CSV-Datei, das
 * Frontend die Auswahlliste im Vorlagen-Editor und die Felder auf den
 * Ticketseiten des Plan-PDFs. Ein Schlüssel steht damit an genau einer Stelle.
 *
 * Kategorienfelder (die frei definierbaren) kommen zur Laufzeit dazu und
 * tragen das Präfix `feld:` vor ihrem Schlüssel — so lassen sie sich von den
 * festen Angaben unterscheiden, ohne dass es zu Namenskollisionen kommt.
 */

export interface ExportSpalte {
  key: string;
  label: string;
}

export const FESTE_EXPORT_SPALTEN: readonly ExportSpalte[] = [
  { key: "ticket_number", label: "Ticket-Nr." },
  { key: "title", label: "Titel" },
  { key: "category", label: "Kategorie" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priorität" },
  { key: "assigned_to", label: "Zuständig" },
  { key: "due_date", label: "Fällig" },
  { key: "gewerk", label: "Gewerk" },
  { key: "raum_bereich", label: "Raum/Bereich" },
  { key: "bauabschnitt", label: "Bauabschnitt" },
  { key: "plan_name", label: "Zeichnung" },
  { key: "created_at", label: "Erstellt am" },
  { key: "created_by", label: "Erstellt von" },
  { key: "updated_at", label: "Geändert am" },
  { key: "description", label: "Beschreibung" },
] as const;

/**
 * Der Satz, der ohne gewählte Vorlage ausgegeben wird - identisch mit dem, was
 * die CSV-Datei vor Einführung der Vorlagen enthielt. Wer nichts einstellt,
 * bekommt also unverändert das Gewohnte.
 */
export const STANDARD_EXPORT_SPALTEN: readonly string[] = [
  "ticket_number",
  "title",
  "category",
  "status",
  "priority",
  "assigned_to",
  "due_date",
  "gewerk",
  "raum_bereich",
  "bauabschnitt",
  "created_at",
  "description",
] as const;

export const FELD_PRAEFIX = "feld:";

export function istKategoriefeld(key: string): boolean {
  return key.startsWith(FELD_PRAEFIX);
}

export function kategoriefeldSchluessel(key: string): string {
  return key.slice(FELD_PRAEFIX.length);
}

export function alsKategoriefeld(feldSchluessel: string): string {
  return `${FELD_PRAEFIX}${feldSchluessel}`;
}

/** Liest die Spaltenliste einer Vorlage; unlesbares gilt als "keine Vorlage". */
export function leseSpalten(columnsJson: string): string[] {
  try {
    const geparst = JSON.parse(columnsJson);
    if (!Array.isArray(geparst)) return [];
    return geparst.filter((k): k is string => typeof k === "string");
  } catch {
    return [];
  }
}
