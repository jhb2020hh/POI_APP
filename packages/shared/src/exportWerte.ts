import type { Point } from "./types.js";
import { istKategoriefeld, kategoriefeldSchluessel } from "./exportSpalten.js";

/**
 * Beschriftungen der Auswahlwerte.
 *
 * Standen bisher nur im Frontend, wodurch die CSV-Datei den Rohwert `open`
 * ausgab, während die Tabelle daneben „Offen" zeigte. Jetzt eine Quelle für
 * beide.
 */
export const STATUS_LABELS: Record<string, string> = {
  open: "Offen",
  in_bearbeitung: "In Bearbeitung",
  geprueft: "Geprüft",
  erledigt: "Erledigt",
  abgeschlossen: "Abgeschlossen",
};

export const PRIORITY_LABELS: Record<string, string> = {
  niedrig: "Niedrig",
  mittel: "Mittel",
  hoch: "Hoch",
};

/**
 * Nachschlagefunktionen für die Angaben, die nicht im Ticket selbst stehen.
 * Wer sie nicht auflösen kann, lässt sie weg - dann bleibt die Zelle leer,
 * statt eine Kennung anzuzeigen, mit der niemand etwas anfangen kann.
 */
export interface ExportKontext {
  kategorieName?: (categoryId: string | null) => string | undefined;
  personName?: (userId: string | null) => string | undefined;
  planName?: (planId: string) => string | undefined;
}

function kategoriefelder(point: Point): Record<string, unknown> {
  if (!point.custom_fields) return {};
  try {
    const geparst = JSON.parse(point.custom_fields);
    return geparst && typeof geparst === "object" ? (geparst as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Der Wert einer Exportspalte für ein Ticket, immer als Zeichenkette.
 *
 * Diese eine Funktion bedient die CSV-Datei *und* die Ticketseiten im
 * Plan-PDF. Beide gaben vorher jeweils ihre eigene, leicht abweichende Liste
 * aus - der Status etwa einmal als `open` und einmal als „Offen".
 */
export function exportWert(point: Point, key: string, kontext: ExportKontext = {}): string {
  if (istKategoriefeld(key)) {
    const wert = kategoriefelder(point)[kategoriefeldSchluessel(key)];
    if (wert === null || wert === undefined) return "";
    if (typeof wert === "boolean") return wert ? "ja" : "nein";
    return String(wert);
  }

  switch (key) {
    case "ticket_number":
      return point.ticket_number ?? "";
    case "title":
      return point.title;
    case "category":
      return kontext.kategorieName?.(point.category_id) ?? "";
    case "status":
      return STATUS_LABELS[point.status] ?? point.status;
    case "priority":
      return point.priority ? PRIORITY_LABELS[point.priority] ?? point.priority : "";
    case "assigned_to":
      return kontext.personName?.(point.assigned_to) ?? "";
    case "due_date":
      return point.due_date ?? "";
    case "gewerk":
      return point.gewerk ?? "";
    case "raum_bereich":
      return point.raum_bereich ?? "";
    case "bauabschnitt":
      return point.bauabschnitt ?? "";
    case "plan_name":
      return kontext.planName?.(point.plan_id) ?? "";
    case "created_at":
      return point.created_at;
    case "created_by":
      return kontext.personName?.(point.created_by) ?? "";
    case "updated_at":
      return point.updated_at;
    case "description":
      return point.description ?? "";
    default:
      // Unbekannter Schluessel - etwa ein Kategoriefeld, das es nicht mehr
      // gibt. Eine leere Zelle ist hier richtig: die Vorlage soll deswegen
      // nicht scheitern.
      return "";
  }
}
