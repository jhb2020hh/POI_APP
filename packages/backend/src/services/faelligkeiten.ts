import { randomUUID } from "node:crypto";
import { db } from "../db/connection.js";
import {
  MailFehler,
  isMailConfigured,
  sendeMail,
  taktPause,
} from "../mail/resend.js";
import {
  betreffFuer,
  htmlFuer,
  textFuer,
  type FaelligerPunkt,
  type Faelligkeitsart,
  type MailAbschnitt,
} from "../mail/vorlage.js";

/**
 * Taegliche Erinnerung an anstehende und ueberschrittene Fristen.
 *
 * Ablauf eines Laufs:
 *   1. offene Tickets mit Frist bis heute+3 lesen
 *   2. je Ticket die Empfaenger bestimmen (zustaendige Person + Admins)
 *   3. je Zeile den Doppelversandschutz beanspruchen
 *   4. je Empfaenger *eine* Mail mit bis zu drei Abschnitten verschicken
 *
 * Punkt 3 vor Punkt 4: der Anspruch wird vor dem Absenden eingetragen. Zwei
 * gleichzeitig laufende Aufrufe koennen so nicht dieselbe Mail zweimal
 * verschicken - der zweite bekommt beim Eintragen nichts mehr zugeteilt.
 * Scheitert der Versand, wird der Anspruch wieder zurueckgenommen.
 */

/** Status, bei denen die Frist noch zaehlt. Fertige Tickets erinnern nicht mehr. */
const OFFENE_STATUS = ["open", "in_bearbeitung", "geprueft"];

/** Vorlaufzeit in Tagen fuer den Abschnitt "Demnaechst faellig". */
const VORLAUF_TAGE = 3;

/**
 * Obergrenze je Lauf. Vercel bricht die Function nach maxDuration ab; mit der
 * Taktpause von Resend sind das rund 40 Mails in 30 Sekunden. Was darueber
 * hinausgeht, bleibt beansprucht - aber ungesendet -, deshalb wird gar nicht
 * erst beansprucht, was nicht mehr rausgeht, und die Zahl wird gemeldet.
 */
const MAX_MAILS_JE_LAUF = 40;

interface PunktZeile extends FaelligerPunkt {
  projekt_id: string;
  assigned_to: string | null;
}

interface Empfaenger {
  id: string;
  email: string;
  display_name: string;
  role: string;
}

interface Zeile {
  punkt: PunktZeile;
  art: Faelligkeitsart;
  dedupeKey: string;
}

export interface VersandBericht {
  stichtag: string;
  gepruefteTickets: number;
  mailsVersendet: number;
  empfaengerUebersprungen: number;
  zeilenBereitsGemeldet: number;
  abgeschnitten: boolean;
  fehler: string[];
  /** Nur beim Trockenlauf gefuellt: was verschickt worden waere. */
  vorschau?: Array<{ an: string; betreff: string; zeilen: number }>;
}

// ---------------------------------------------------------------------------
// Datum
// ---------------------------------------------------------------------------

/**
 * Heutiges Datum in deutscher Zeit als YYYY-MM-DD.
 *
 * Nicht new Date().toISOString(): der Lauf ist fuer 05:00 UTC geplant, das ist
 * in Deutschland bereits der 6. bzw. 7. Stundenschlag desselben Tages - aber im
 * Winter waere ein Lauf um 23:30 UTC schon der Folgetag. Massgeblich ist die
 * Zeitzone, in der die Fristen eingetragen werden.
 */
export function heuteInDeutschland(jetzt: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(jetzt);
}

function plusTage(isoDatum: string, tage: number): string {
  const datum = new Date(`${isoDatum}T00:00:00Z`);
  datum.setUTCDate(datum.getUTCDate() + tage);
  return datum.toISOString().slice(0, 10);
}

/** Montag der Woche, in der das Datum liegt - Stempel fuer die Wochenmeldung. */
function montagDerWoche(isoDatum: string): string {
  const datum = new Date(`${isoDatum}T00:00:00Z`);
  // getUTCDay: 0 = Sonntag. Der Sonntag gehoert zur Woche, die am Montag davor
  // begann, deshalb dort 6 Tage zurueck statt 0.
  const versatz = (datum.getUTCDay() + 6) % 7;
  return plusTage(isoDatum, -versatz);
}

function artFuer(dueDate: string, heute: string): Faelligkeitsart | null {
  if (dueDate < heute) return "ueberfaellig";
  if (dueDate === heute) return "heute";
  if (dueDate <= plusTage(heute, VORLAUF_TAGE)) return "bald";
  return null;
}

/**
 * Fachlicher Schluessel einer gemeldeten Zeile.
 *
 * Fuer "heute" und "bald" geht die Frist mit ein: wird ein Ticket verschoben,
 * ist der Schluessel ein anderer und die neue Frist wird wieder gemeldet.
 * Ueberfaellige Tickets wuerden sonst jeden Tag erneut auftauchen - dort steht
 * deshalb der Montag der laufenden Woche im Schluessel, also eine Meldung je
 * Woche.
 */
function dedupeKeyFuer(punkt: PunktZeile, art: Faelligkeitsart, heute: string): string {
  const stempel = art === "ueberfaellig" ? montagDerWoche(heute) : punkt.due_date;
  return `faellig:${art}:${punkt.point_id}:${stempel}`;
}

// ---------------------------------------------------------------------------
// Daten lesen
// ---------------------------------------------------------------------------

async function ladeFaelligePunkte(heute: string): Promise<PunktZeile[]> {
  const platzhalter = OFFENE_STATUS.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT
         p.id            AS point_id,
         p.ticket_number,
         p.title         AS titel,
         p.due_date,
         p.priority,
         p.status,
         p.assigned_to,
         pl.name         AS plan_name,
         pr.id           AS projekt_id,
         pr.name         AS projekt_name,
         u.display_name  AS zustaendig
       FROM points p
       JOIN plans pl    ON pl.id = p.plan_id
       JOIN projects pr ON pr.id = pl.project_id
       LEFT JOIN users u ON u.id = p.assigned_to
       WHERE p.deleted = 0
         AND pr.archived = 0
         AND p.due_date IS NOT NULL
         AND p.due_date <> ''
         AND p.due_date <= ?
         AND p.status IN (${platzhalter})
       ORDER BY p.due_date ASC, p.ticket_number ASC`
    )
    .all<PunktZeile>(plusTage(heute, VORLAUF_TAGE), ...OFFENE_STATUS);
}

/** Freigeschaltete Konten, die Mails empfangen wollen - nach Kennung. */
async function ladeEmpfaenger(): Promise<Map<string, Empfaenger>> {
  const zeilen = await db
    .prepare(
      `SELECT id, email, display_name, role FROM users
       WHERE approved = 1 AND email_benachrichtigungen = 1`
    )
    .all<Empfaenger>();
  return new Map(zeilen.map((zeile) => [zeile.id, zeile]));
}

/** Admins bekommen eine Abschrift - auch von Tickets ohne Zuordnung. */
function adminsAus(empfaenger: Map<string, Empfaenger>): Empfaenger[] {
  return [...empfaenger.values()].filter((person) => person.role === "admin");
}

// ---------------------------------------------------------------------------
// Doppelversandschutz
// ---------------------------------------------------------------------------

/**
 * Traegt den Anspruch auf eine Zeile ein. `false` heisst: schon gemeldet.
 *
 * Der Schluessel enthaelt den Empfaenger, damit eine fehlgeschlagene Mail an
 * eine Person die Meldung an die anderen nicht mit zurueckzieht.
 */
async function beanspruche(
  punkt: PunktZeile,
  empfaengerId: string,
  art: Faelligkeitsart,
  basisSchluessel: string
): Promise<string | null> {
  const schluessel = `${basisSchluessel}:${empfaengerId}`;
  const ergebnis = await db
    .prepare(
      `INSERT INTO notifications
         (id, project_id, point_id, recipient_id, type, message, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (dedupe_key) DO NOTHING`
    )
    .run(
      randomUUID(),
      punkt.projekt_id,
      punkt.point_id,
      empfaengerId,
      `faelligkeit_${art}`,
      `${punkt.ticket_number ?? punkt.titel}: Frist ${punkt.due_date}`,
      schluessel
    );
  return ergebnis.changes > 0 ? schluessel : null;
}

async function gibFrei(schluessel: string[]): Promise<void> {
  for (const eintrag of schluessel) {
    await db.prepare("DELETE FROM notifications WHERE dedupe_key = ?").run(eintrag);
  }
}

// ---------------------------------------------------------------------------
// Lauf
// ---------------------------------------------------------------------------

function inAbschnitte(zeilen: Zeile[]): MailAbschnitt[] {
  const reihenfolge: Faelligkeitsart[] = ["ueberfaellig", "heute", "bald"];
  return reihenfolge
    .map((art) => ({
      art,
      punkte: zeilen.filter((zeile) => zeile.art === art).map((zeile) => zeile.punkt),
    }))
    .filter((abschnitt) => abschnitt.punkte.length > 0);
}

export async function versendeFaelligkeitsMails(optionen: {
  trockenlauf?: boolean;
  stichtag?: string;
} = {}): Promise<VersandBericht> {
  const heute = optionen.stichtag ?? heuteInDeutschland();
  const trockenlauf = optionen.trockenlauf === true;

  const bericht: VersandBericht = {
    stichtag: heute,
    gepruefteTickets: 0,
    mailsVersendet: 0,
    empfaengerUebersprungen: 0,
    zeilenBereitsGemeldet: 0,
    abgeschnitten: false,
    fehler: [],
  };
  if (trockenlauf) bericht.vorschau = [];

  const punkte = await ladeFaelligePunkte(heute);
  bericht.gepruefteTickets = punkte.length;
  if (punkte.length === 0) return bericht;

  const empfaenger = await ladeEmpfaenger();
  const admins = adminsAus(empfaenger);

  // Erst gruppieren, dann beanspruchen: so steht vor dem ersten Eintrag fest,
  // wer ueberhaupt eine Mail bekaeme.
  const zuordnung = new Map<string, Zeile[]>();

  for (const punkt of punkte) {
    const art = artFuer(punkt.due_date, heute);
    if (!art) continue;

    const basis = dedupeKeyFuer(punkt, art, heute);

    const ziele = new Map<string, Empfaenger>();
    const zustaendig = punkt.assigned_to ? empfaenger.get(punkt.assigned_to) : undefined;
    if (zustaendig) ziele.set(zustaendig.id, zustaendig);
    if (punkt.assigned_to && !zustaendig) bericht.empfaengerUebersprungen += 1;
    for (const admin of admins) ziele.set(admin.id, admin);

    for (const ziel of ziele.values()) {
      const schluessel = trockenlauf
        ? `${basis}:${ziel.id}`
        : await beanspruche(punkt, ziel.id, art, basis);
      if (!schluessel) {
        bericht.zeilenBereitsGemeldet += 1;
        continue;
      }
      const bisher = zuordnung.get(ziel.id) ?? [];
      bisher.push({ punkt, art, dedupeKey: schluessel });
      zuordnung.set(ziel.id, bisher);
    }
  }

  if (zuordnung.size === 0) return bericht;

  if (!trockenlauf && !isMailConfigured) {
    // Ansprueche wieder freigeben, sonst gaelte die Zeile als gemeldet, obwohl
    // nie etwas rausging.
    for (const zeilen of zuordnung.values()) {
      await gibFrei(zeilen.map((zeile) => zeile.dedupeKey));
    }
    bericht.fehler.push("RESEND_API_KEY ist nicht gesetzt - es wurde nichts verschickt");
    return bericht;
  }

  let versendet = 0;
  for (const [empfaengerId, zeilen] of zuordnung) {
    const person = empfaenger.get(empfaengerId)!;
    const abschnitte = inAbschnitte(zeilen);
    const betreff = betreffFuer(abschnitte);

    if (trockenlauf) {
      bericht.vorschau!.push({ an: person.email, betreff, zeilen: zeilen.length });
      continue;
    }

    if (versendet >= MAX_MAILS_JE_LAUF) {
      bericht.abgeschnitten = true;
      await gibFrei(zeilen.map((zeile) => zeile.dedupeKey));
      continue;
    }

    const anrede = person.display_name || person.email;
    try {
      if (versendet > 0) await taktPause();
      await sendeMail({
        an: person.email,
        betreff,
        html: htmlFuer(anrede, abschnitte),
        text: textFuer(anrede, abschnitte),
      });
      versendet += 1;
    } catch (error) {
      await gibFrei(zeilen.map((zeile) => zeile.dedupeKey));
      const meldung =
        error instanceof MailFehler ? error.message : `unbekannter Fehler: ${String(error)}`;
      bericht.fehler.push(`${person.email}: ${meldung}`);
    }
  }

  bericht.mailsVersendet = versendet;
  return bericht;
}
