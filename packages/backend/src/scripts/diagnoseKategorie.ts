import "../loadEnv.js";
import { randomUUID } from "node:crypto";
import { db, pool } from "../db/connection.js";
import { createCategory, updateCategory } from "../repositories/categoryRepository.js";
import { createPoint, getPointById } from "../repositories/pointRepository.js";

/**
 * Prueft das Bearbeiten von Ticketvorlagen und raeumt hinterher auf.
 *
 *   npm run diagnose:kategorie
 *
 * Die Frage, auf die es ankommt: Was passiert mit Tickets, die es schon gibt?
 * Der Kurzcode steckt in jeder vergebenen Ticketnummer und bildet zusammen mit
 * dem Projekt den Schluessel des Nummernzaehlers - er darf sich deshalb nicht
 * aendern lassen. Und ein entferntes Feld darf keine Werte loeschen, sondern
 * sie nur nicht mehr anzeigen.
 */

function melde(ok: boolean, name: string, detail: string): boolean {
  console.log(`${ok ? "  OK  " : " FEHL "} ${name.padEnd(50)} ${detail}`);
  return ok;
}

async function main(): Promise<void> {
  const kennung = randomUUID().slice(0, 8);
  const projektId = `diag-kat-projekt-${kennung}`;
  const planId = `diag-kat-plan-${kennung}`;
  const punktId = `diag-kat-punkt-${kennung}`;
  let kategorieId = "";

  let alleOk = true;

  try {
    // Die Projektnummer ist Pflicht: ohne sie vergibt buildTicketNumber gar
    // keine Ticketnummer, und genau die soll hier geprueft werden.
    await db
      .prepare("INSERT INTO projects (id, name, project_number) VALUES (?, ?, ?)")
      .run(projektId, `Diagnose Kategorie ${kennung}`, `DIAG-${kennung.toUpperCase()}`);
    await db
      .prepare("INSERT INTO plans (id, project_id, name) VALUES (?, ?, ?)")
      .run(planId, projektId, "Diagnose-Zeichnung");

    const kategorie = await createCategory({
      projectId: projektId,
      name: "Kollision",
      color: "#3a86ff",
      glyph: "!",
      shortCode: "KOL",
      fieldSchemaJson: JSON.stringify({
        version: 1,
        fields: [
          { key: "raum", label: "Raum", type: "text" },
          { key: "hoehe", label: "Höhe", type: "text" },
        ],
      }),
    });
    kategorieId = kategorie.id;

    await createPoint({
      id: punktId,
      planId,
      x: 0.5,
      y: 0.5,
      title: "Ticket vor der Änderung",
      categoryId: kategorie.id,
      customFields: JSON.stringify({ raum: "R1.02", hoehe: "2,80 m" }),
    });

    const vorher = (await getPointById(punktId))!;
    alleOk =
      melde(
        Boolean(vorher.ticket_number?.includes("KOL")),
        "Ticketnummer enthält den Kurzcode",
        vorher.ticket_number ?? "keine vergeben"
      ) && alleOk;

    // --- Aendern: Name, Farbe, ein Feld entfernt ---------------------------
    const geaendert = await updateCategory(kategorie.id, {
      name: "Kollision (geprüft)",
      color: "#e63946",
      glyph: "⚠",
      fieldSchemaJson: JSON.stringify({
        version: 1,
        fields: [{ key: "raum", label: "Raum", type: "text" }],
      }),
    });

    alleOk =
      melde(
        geaendert?.name === "Kollision (geprüft)" && geaendert?.color === "#e63946",
        "Name, Farbe und Symbol geändert",
        `${geaendert?.name} · ${geaendert?.color} · ${geaendert?.glyph}`
      ) && alleOk;

    alleOk =
      melde(
        geaendert?.short_code === "KOL",
        "Kurzcode bleibt unverändert",
        geaendert?.short_code ?? "fehlt"
      ) && alleOk;

    // --- Das bestehende Ticket muss unberuehrt sein ------------------------
    const nachher = (await getPointById(punktId))!;
    alleOk =
      melde(
        nachher.ticket_number === vorher.ticket_number,
        "Ticketnummer des bestehenden Tickets unverändert",
        `${vorher.ticket_number} → ${nachher.ticket_number}`
      ) && alleOk;

    const werte = JSON.parse(nachher.custom_fields ?? "{}") as Record<string, string>;
    alleOk =
      melde(
        werte.raum === "R1.02" && werte.hoehe === "2,80 m",
        "Werte des entfernten Feldes bleiben erhalten",
        `raum=${werte.raum ?? "weg"}, hoehe=${werte.hoehe ?? "weg"}`
      ) && alleOk;

    // --- Ein neues Ticket zaehlt im selben Nummernkreis weiter -------------
    const zweiterPunktId = `${punktId}-2`;
    await createPoint({
      id: zweiterPunktId,
      planId,
      x: 0.6,
      y: 0.6,
      title: "Ticket nach der Änderung",
      categoryId: kategorie.id,
    });
    const zweiter = (await getPointById(zweiterPunktId))!;
    await db.prepare("DELETE FROM points WHERE id = ?").run(zweiterPunktId);

    alleOk =
      melde(
        Boolean(zweiter.ticket_number?.includes("KOL")) &&
          zweiter.ticket_number !== vorher.ticket_number,
        "neues Ticket zählt im selben Nummernkreis weiter",
        `${vorher.ticket_number} → ${zweiter.ticket_number}`
      ) && alleOk;
  } finally {
    await db.prepare("DELETE FROM point_status_history WHERE point_id LIKE ?").run(`${punktId}%`);
    await db.prepare("DELETE FROM notifications WHERE point_id LIKE ?").run(`${punktId}%`);
    await db.prepare("DELETE FROM points WHERE id LIKE ?").run(`${punktId}%`);
    await db.prepare("DELETE FROM ticket_number_counters WHERE project_id = ?").run(projektId);
    if (kategorieId) {
      await db.prepare("DELETE FROM categories WHERE id = ?").run(kategorieId);
    }
    await db.prepare("DELETE FROM plans WHERE id = ?").run(planId);
    await db.prepare("DELETE FROM change_log WHERE project_id = ?").run(projektId);
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
