import "../loadEnv.js";
import { randomUUID } from "node:crypto";
import { db, pool } from "../db/connection.js";
import { listPointsByPlan, listPointsByProject } from "../repositories/pointRepository.js";

/**
 * Prueft die Ticketfilter und raeumt hinterher auf.
 *
 *   npm run diagnose:filter
 *
 * Hintergrund: Ansicht und Ausgaben liefen frueher ueber verschiedene
 * Abfragen mit verschiedenem Filterumfang - mit gesetztem Gewerkfilter zeigte
 * die Ansicht mehr Tickets, als der Export danach ausgab. Seitdem beide
 * dieselbe Funktion verwenden, ist die offene Frage nur noch, ob die Auswahl
 * selbst stimmt. Genau das prueft dieses Skript.
 *
 * Besonders im Blick: der "bis"-Filter. Das Datumsfeld liefert `2026-08-10`,
 * `created_at` ist ein voller Zeitstempel - ein Vergleich ohne Ausdehnung auf
 * das Tagesende verlor den gesamten letzten Tag.
 */

function melde(ok: boolean, name: string, detail: string): boolean {
  console.log(`${ok ? "  OK  " : " FEHL "} ${name.padEnd(52)} ${detail}`);
  return ok;
}

async function main(): Promise<void> {
  const kennung = randomUUID().slice(0, 8);
  const projektId = `diag-filter-projekt-${kennung}`;
  const planId = `diag-filter-plan-${kennung}`;
  const zweiterPlanId = `diag-filter-plan2-${kennung}`;
  const punktIds: string[] = [];

  let alleOk = true;

  try {
    await db
      .prepare("INSERT INTO projects (id, name) VALUES (?, ?)")
      .run(projektId, `Diagnose Filter ${kennung}`);
    await db
      .prepare("INSERT INTO plans (id, project_id, name) VALUES (?, ?, ?)")
      .run(planId, projektId, "Zeichnung A");
    await db
      .prepare("INSERT INTO plans (id, project_id, name) VALUES (?, ?, ?)")
      .run(zweiterPlanId, projektId, "Zeichnung B");

    // created_at wird bewusst gesetzt statt dem Vorgabewert ueberlassen: der
    // "bis"-Filter laesst sich sonst nicht pruefen.
    const tickets: Array<{
      plan: string;
      titel: string;
      gewerk: string | null;
      status: string;
      erstellt: string;
    }> = [
      { plan: planId, titel: "Elektro offen", gewerk: "Elektro", status: "open", erstellt: "2026-03-10T08:00:00.000Z" },
      { plan: planId, titel: "Elektro erledigt", gewerk: "Elektro", status: "erledigt", erstellt: "2026-03-10T20:30:00.000Z" },
      { plan: planId, titel: "Sanitär offen", gewerk: "Sanitär", status: "open", erstellt: "2026-03-11T09:00:00.000Z" },
      { plan: planId, titel: "ohne Gewerk", gewerk: null, status: "open", erstellt: "2026-03-12T09:00:00.000Z" },
      { plan: zweiterPlanId, titel: "Elektro auf Zeichnung B", gewerk: "Elektro", status: "open", erstellt: "2026-03-11T10:00:00.000Z" },
    ];

    for (const ticket of tickets) {
      const id = `diag-filter-punkt-${kennung}-${punktIds.length}`;
      punktIds.push(id);
      await db
        .prepare(
          `INSERT INTO points (id, plan_id, x, y, title, status, gewerk, created_at)
           VALUES (?, ?, 0.5, 0.5, ?, ?, ?, ?)`
        )
        .run(id, ticket.plan, ticket.titel, ticket.status, ticket.gewerk, ticket.erstellt);
    }

    const eigene = (liste: { id: string }[]) =>
      liste.filter((p) => p.id.startsWith(`diag-filter-punkt-${kennung}-`));

    // --- Gewerk ------------------------------------------------------------
    const nurElektro = eigene(await listPointsByProject(projektId, { gewerk: "Elektro" }));
    alleOk =
      melde(
        nurElektro.length === 3,
        "Gewerkfilter über das Projekt",
        `${nurElektro.length} von 3 erwartet`
      ) && alleOk;

    const elektroAufA = eigene(
      await listPointsByProject(projektId, { gewerk: "Elektro", planId })
    );
    alleOk =
      melde(
        elektroAufA.length === 2,
        "Gewerk + Zeichnung zusammen",
        `${elektroAufA.length} von 2 erwartet`
      ) && alleOk;

    // Der Weg, den die Ansicht frueher nahm: er kennt gewerk gar nicht. Der
    // Vergleich haelt fest, warum die Ansicht nicht mehr darueber laeuft.
    const ueberDenAltenWeg = eigene(await listPointsByPlan(planId, {}));
    alleOk =
      melde(
        ueberDenAltenWeg.length > elektroAufA.length,
        "alter Weg zeigt mehr als der gefilterte",
        `${ueberDenAltenWeg.length} gegenüber ${elektroAufA.length} - genau die gemeldete Abweichung`
      ) && alleOk;

    // --- Status ------------------------------------------------------------
    const nurOffen = eigene(await listPointsByProject(projektId, { status: "open" }));
    alleOk =
      melde(nurOffen.length === 4, "Statusfilter", `${nurOffen.length} von 4 erwartet`) &&
      alleOk;

    // --- Zeitraum ----------------------------------------------------------
    // Der entscheidende Fall: das zweite Ticket entstand am 10.03. um 20:30 Uhr.
    // Ohne Ausdehnung auf das Tagesende faellt es aus "bis 10.03." heraus.
    const bisZehnter = eigene(
      await listPointsByProject(projektId, { to: "2026-03-10" })
    );
    alleOk =
      melde(
        bisZehnter.length === 2,
        '"bis 10.03." enthält den ganzen 10.03.',
        `${bisZehnter.length} von 2 erwartet (auch das Ticket von 20:30 Uhr)`
      ) && alleOk;

    const abElftem = eigene(await listPointsByProject(projektId, { from: "2026-03-11" }));
    alleOk =
      melde(abElftem.length === 3, '"ab 11.03."', `${abElftem.length} von 3 erwartet`) &&
      alleOk;

    const genauElfter = eigene(
      await listPointsByProject(projektId, { from: "2026-03-11", to: "2026-03-11" })
    );
    alleOk =
      melde(
        genauElfter.length === 2,
        "Zeitraum von und bis auf denselben Tag",
        `${genauElfter.length} von 2 erwartet`
      ) && alleOk;

    // --- ohne Filter -------------------------------------------------------
    const alle = eigene(await listPointsByProject(projektId, {}));
    alleOk =
      melde(alle.length === 5, "ohne Filter alle Tickets", `${alle.length} von 5 erwartet`) &&
      alleOk;
  } finally {
    for (const id of punktIds) {
      await db.prepare("DELETE FROM points WHERE id = ?").run(id);
    }
    await db.prepare("DELETE FROM plans WHERE id = ?").run(planId);
    await db.prepare("DELETE FROM plans WHERE id = ?").run(zweiterPlanId);
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
