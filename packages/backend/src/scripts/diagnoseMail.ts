import "../loadEnv.js";
import { randomUUID } from "node:crypto";
import { db, pool } from "../db/connection.js";
import { isMailConfigured } from "../mail/resend.js";
import {
  heuteInDeutschland,
  versendeFaelligkeitsMails,
} from "../services/faelligkeiten.js";

/**
 * Spielt den Faelligkeitsversand end-to-end durch und raeumt hinterher auf.
 *
 *   npm run diagnose:mail                 -> Trockenlauf, verschickt nichts
 *   npm run diagnose:mail -- --senden     -> verschickt echte Mails
 *
 * Angelegt wird ein eigenes Projekt mit einer Zeichnung und drei Tickets: eines
 * ueberfaellig, eines heute faellig, eines in zwei Tagen. Geprueft wird, dass
 * genau diese drei in der Auswertung landen, dass der zweite Lauf nichts mehr
 * meldet (Doppelversandschutz) und dass eine verschobene Frist wieder gemeldet
 * wird.
 *
 * Ohne --senden wird kein Anspruch eingetragen und nichts verschickt; der
 * Doppelversandschutz laesst sich dann nicht pruefen und die Schritte werden
 * uebersprungen.
 */

const SENDEN = process.argv.includes("--senden");

function melde(ok: boolean, name: string, detail: string): boolean {
  console.log(`${ok ? "  OK  " : " FEHL "} ${name.padEnd(46)} ${detail}`);
  return ok;
}

function plusTage(isoDatum: string, tage: number): string {
  const datum = new Date(`${isoDatum}T00:00:00Z`);
  datum.setUTCDate(datum.getUTCDate() + tage);
  return datum.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const heute = heuteInDeutschland();
  const kennung = randomUUID().slice(0, 8);

  const projektId = `diag-mail-projekt-${kennung}`;
  const planId = `diag-mail-plan-${kennung}`;
  const punktIds = [1, 2, 3].map((n) => `diag-mail-punkt-${kennung}-${n}`);

  let alleOk = true;

  console.log(`Stichtag (deutsche Zeit): ${heute}`);
  console.log(`Mailversand konfiguriert: ${isMailConfigured ? "ja" : "nein"}`);
  console.log(SENDEN ? "Modus: es werden echte Mails verschickt" : "Modus: Trockenlauf");
  console.log("");

  try {
    await db
      .prepare("INSERT INTO projects (id, name, description) VALUES (?, ?, ?)")
      .run(projektId, `Diagnose Mailversand ${kennung}`, "wird wieder entfernt");
    await db
      .prepare("INSERT INTO plans (id, project_id, name) VALUES (?, ?, ?)")
      .run(planId, projektId, "Diagnose-Zeichnung");

    const tickets: Array<[string, string, string]> = [
      [punktIds[0], "Überfällig seit vier Tagen", plusTage(heute, -4)],
      [punktIds[1], "Heute fällig", heute],
      [punktIds[2], "In zwei Tagen fällig", plusTage(heute, 2)],
    ];
    for (const [id, titel, frist] of tickets) {
      await db
        .prepare(
          `INSERT INTO points (id, plan_id, x, y, title, status, due_date)
           VALUES (?, ?, 0.5, 0.5, ?, 'open', ?)`
        )
        .run(id, planId, titel, frist);
    }

    // Ein Ticket ausserhalb des Vorlaufs - darf nicht auftauchen.
    const spaeterId = `diag-mail-punkt-${kennung}-spaet`;
    punktIds.push(spaeterId);
    await db
      .prepare(
        `INSERT INTO points (id, plan_id, x, y, title, status, due_date)
         VALUES (?, ?, 0.5, 0.5, ?, 'open', ?)`
      )
      .run(spaeterId, planId, "Erst in zwei Wochen fällig", plusTage(heute, 14));

    // Und ein bereits erledigtes mit ueberschrittener Frist - ebenfalls nicht.
    const erledigtId = `diag-mail-punkt-${kennung}-fertig`;
    punktIds.push(erledigtId);
    await db
      .prepare(
        `INSERT INTO points (id, plan_id, x, y, title, status, due_date)
         VALUES (?, ?, 0.5, 0.5, ?, 'erledigt', ?)`
      )
      .run(erledigtId, planId, "Längst erledigt", plusTage(heute, -9));

    // --- Lauf 1 -----------------------------------------------------------
    const lauf1 = await versendeFaelligkeitsMails({ trockenlauf: !SENDEN });

    // Es koennen Tickets aus echten Projekten dabei sein - deshalb wird nicht
    // auf eine feste Zahl geprueft, sondern ob unsere drei enthalten sind und
    // die beiden anderen nicht.
    const platzhalter = punktIds.map(() => "?").join(", ");
    const gefunden = await db
      .prepare(
        `SELECT id FROM points
         WHERE id IN (${platzhalter})
           AND deleted = 0 AND due_date <= ?
           AND status IN ('open','in_bearbeitung','geprueft')`
      )
      .all<{ id: string }>(...punktIds, plusTage(heute, 3));

    alleOk =
      melde(
        gefunden.length === 3,
        "drei fällige Tickets erkannt",
        `${gefunden.length} von 3 (spätere und erledigte bleiben draußen)`
      ) && alleOk;

    alleOk =
      melde(
        lauf1.gepruefteTickets >= 3,
        "Auswertung hat die Tickets gelesen",
        `${lauf1.gepruefteTickets} Tickets insgesamt im Zeitfenster`
      ) && alleOk;

    if (lauf1.fehler.length > 0) {
      console.log(`        Fehler im Lauf: ${lauf1.fehler.join(" | ")}`);
    }

    if (!SENDEN) {
      const zeilen = (lauf1.vorschau ?? []).reduce((s, v) => s + v.zeilen, 0);
      melde(
        true,
        "Vorschau erzeugt",
        `${lauf1.vorschau?.length ?? 0} Empfänger, ${zeilen} Zeilen`
      );
      for (const eintrag of lauf1.vorschau ?? []) {
        console.log(`        -> ${eintrag.an}: ${eintrag.betreff}`);
      }
      console.log("");
      console.log("Trockenlauf: Doppelversandschutz wurde nicht geprüft.");
      console.log("Mit  npm run diagnose:mail -- --senden  komplett durchspielen.");
    } else {
      alleOk =
        melde(
          lauf1.mailsVersendet > 0,
          "Mails verschickt",
          `${lauf1.mailsVersendet} Stück`
        ) && alleOk;

      // --- Lauf 2: derselbe Tag, es darf nichts mehr rausgehen -------------
      const lauf2 = await versendeFaelligkeitsMails({});
      alleOk =
        melde(
          lauf2.mailsVersendet === 0,
          "zweiter Lauf verschickt nichts mehr",
          `${lauf2.zeilenBereitsGemeldet} Zeilen bereits gemeldet`
        ) && alleOk;

      // --- Frist verschieben: muss wieder gemeldet werden ------------------
      await db
        .prepare("UPDATE points SET due_date = ? WHERE id = ?")
        .run(plusTage(heute, 1), punktIds[1]);
      const lauf3 = await versendeFaelligkeitsMails({});
      alleOk =
        melde(
          lauf3.mailsVersendet > 0,
          "verschobene Frist wird erneut gemeldet",
          `${lauf3.mailsVersendet} Mail(s)`
        ) && alleOk;
    }
  } finally {
    // Aufraeumen in Abhaengigkeitsreihenfolge.
    for (const id of punktIds) {
      await db.prepare("DELETE FROM notifications WHERE point_id = ?").run(id);
      await db.prepare("DELETE FROM points WHERE id = ?").run(id);
    }
    await db.prepare("DELETE FROM notifications WHERE project_id = ?").run(projektId);
    await db.prepare("DELETE FROM plans WHERE id = ?").run(planId);
    await db.prepare("DELETE FROM projects WHERE id = ?").run(projektId);
    console.log("");
    console.log("Testdaten entfernt.");
    await pool.end();
  }

  console.log("");
  console.log(alleOk ? "Ergebnis: alles in Ordnung." : "Ergebnis: es gibt Abweichungen.");
  if (!alleOk) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
