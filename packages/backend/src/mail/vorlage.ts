import { anwendungsAdresse } from "./resend.js";

/**
 * Baut die Erinnerungsmail - eine je Person und Lauf, mit bis zu drei
 * Abschnitten.
 *
 * Keine Tiefenlinks auf einzelne Tickets: das Frontend kennt derzeit keine
 * Adressen fuer einzelne Punkte (kein Router, keine Auswertung von
 * location.hash). Ein erfundener Link wuerde auf der Startseite landen und den
 * Eindruck erwecken, er waere kaputt. Verlinkt wird deshalb die Anwendung.
 */

export interface FaelligerPunkt {
  point_id: string;
  ticket_number: string | null;
  titel: string;
  projekt_name: string;
  plan_name: string | null;
  due_date: string;
  priority: string | null;
  status: string;
  /** Anzeigename der zustaendigen Person, leer wenn niemand zugeordnet ist. */
  zustaendig: string | null;
}

export type Faelligkeitsart = "ueberfaellig" | "heute" | "bald";

export interface MailAbschnitt {
  art: Faelligkeitsart;
  punkte: FaelligerPunkt[];
}

const UEBERSCHRIFTEN: Record<Faelligkeitsart, string> = {
  ueberfaellig: "Überfällig",
  heute: "Heute fällig",
  bald: "Demnächst fällig",
};

const FARBEN: Record<Faelligkeitsart, string> = {
  ueberfaellig: "#b42318",
  heute: "#b54708",
  bald: "#175cd3",
};

/** 2026-08-14 -> 14.08.2026. Unbekanntes Format bleibt unveraendert stehen. */
function alsDatum(iso: string): string {
  const treffer = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!treffer) return iso;
  return `${treffer[3]}.${treffer[2]}.${treffer[1]}`;
}

function alsTicket(punkt: FaelligerPunkt): string {
  return punkt.ticket_number ?? "ohne Nummer";
}

/** Verhindert, dass Titel mit < oder & die Struktur der Mail zerlegen. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function betreffFuer(abschnitte: MailAbschnitt[]): string {
  const anzahl = abschnitte.reduce((summe, a) => summe + a.punkte.length, 0);
  const ueberfaellig = abschnitte.find((a) => a.art === "ueberfaellig");
  const wort = anzahl === 1 ? "Ticket" : "Tickets";

  if (ueberfaellig && ueberfaellig.punkte.length > 0) {
    return `POI-App: ${anzahl} ${wort} mit Frist – ${ueberfaellig.punkte.length} überfällig`;
  }
  return `POI-App: ${anzahl} ${wort} mit anstehender Frist`;
}

function zeileAlsText(punkt: FaelligerPunkt): string {
  const teile = [
    `  - ${alsTicket(punkt)}  ${punkt.titel}`,
    `    fällig ${alsDatum(punkt.due_date)} | Projekt ${punkt.projekt_name}`,
  ];
  if (punkt.plan_name) teile.push(`    Zeichnung ${punkt.plan_name}`);
  if (!punkt.zustaendig) teile.push(`    niemand zugeordnet`);
  return teile.join("\n");
}

export function textFuer(anrede: string, abschnitte: MailAbschnitt[]): string {
  const bloecke = abschnitte
    .filter((a) => a.punkte.length > 0)
    .map((a) => `${UEBERSCHRIFTEN[a.art]}\n${a.punkte.map(zeileAlsText).join("\n")}`);

  return [
    `Hallo ${anrede},`,
    "",
    "die folgenden Tickets haben eine anstehende oder überschrittene Frist:",
    "",
    bloecke.join("\n\n"),
    "",
    anwendungsAdresse() || "(Adresse der Anwendung ist nicht hinterlegt)",
    "",
    "Diese Nachricht wurde automatisch erzeugt. Die Erinnerungen lassen sich in",
    "der Anwendung unter „Benachrichtigungen“ abstellen.",
  ].join("\n");
}

function zeileAlsHtml(punkt: FaelligerPunkt): string {
  const nebenzeile = [
    `fällig ${alsDatum(punkt.due_date)}`,
    punkt.projekt_name,
    punkt.plan_name ?? null,
    punkt.zustaendig ? null : "niemand zugeordnet",
  ]
    .filter((teil): teil is string => Boolean(teil))
    .map(escapeHtml)
    .join(" &middot; ");

  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eaecf0;">
        <div style="font-size:12px;color:#667085;">${escapeHtml(alsTicket(punkt))}</div>
        <div style="font-size:15px;color:#101828;font-weight:600;">${escapeHtml(punkt.titel)}</div>
        <div style="font-size:13px;color:#667085;">${nebenzeile}</div>
      </td>
    </tr>`;
}

function abschnittAlsHtml(abschnitt: MailAbschnitt): string {
  if (abschnitt.punkte.length === 0) return "";
  return `
    <h2 style="margin:28px 0 4px;font-size:15px;color:${FARBEN[abschnitt.art]};">
      ${UEBERSCHRIFTEN[abschnitt.art]} (${abschnitt.punkte.length})
    </h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      ${abschnitt.punkte.map(zeileAlsHtml).join("")}
    </table>`;
}

export function htmlFuer(anrede: string, abschnitte: MailAbschnitt[]): string {
  const adresse = anwendungsAdresse();
  const schaltflaeche = adresse
    ? `<a href="${escapeHtml(adresse)}"
          style="display:inline-block;margin-top:28px;padding:10px 18px;background:#175cd3;
                 color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;">
         In der POI-App öffnen
       </a>`
    : "";

  return `<!doctype html>
<html lang="de">
  <body style="margin:0;padding:24px;background:#f9fafb;
               font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #eaecf0;
                border-radius:10px;padding:28px;">
      <p style="margin:0 0 4px;font-size:15px;color:#101828;">Hallo ${escapeHtml(anrede)},</p>
      <p style="margin:0;font-size:14px;color:#475467;">
        die folgenden Tickets haben eine anstehende oder überschrittene Frist.
      </p>
      ${abschnitte.map(abschnittAlsHtml).join("")}
      ${schaltflaeche}
      <p style="margin:28px 0 0;font-size:12px;color:#98a2b3;border-top:1px solid #eaecf0;padding-top:16px;">
        Diese Nachricht wurde automatisch erzeugt. Die Erinnerungen lassen sich in
        der Anwendung unter „Benachrichtigungen“ abstellen.
      </p>
    </div>
  </body>
</html>`;
}
