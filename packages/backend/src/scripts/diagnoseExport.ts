import "../loadEnv.js";
import { randomUUID } from "node:crypto";
import {
  FESTE_EXPORT_SPALTEN,
  STANDARD_EXPORT_SPALTEN,
  alsKategoriefeld,
  exportWert,
  leseSpalten,
} from "@poi-app/shared";
import { db, pool } from "../db/connection.js";
import { createCategory } from "../repositories/categoryRepository.js";
import { createPoint, getPointById } from "../repositories/pointRepository.js";
import {
  archiveExportTemplate,
  createExportTemplate,
  listExportTemplatesForProject,
  updateExportTemplate,
} from "../repositories/exportTemplateRepository.js";

/**
 * Prueft Exportvorlagen und den Wertezugriff und raeumt hinterher auf.
 *
 *   npm run diagnose:export
 *
 * Worauf es ankommt: die Vorlage bestimmt Auswahl *und* Reihenfolge der
 * Spalten, Kategoriefelder werden mit ausgegeben, und die Beschriftungen sind
 * dieselben wie in der Oberflaeche - der Status stand in der CSV-Datei vorher
 * als `open` statt als "Offen".
 */

function melde(ok: boolean, name: string, detail: string): boolean {
  console.log(`${ok ? "  OK  " : " FEHL "} ${name.padEnd(52)} ${detail}`);
  return ok;
}

async function main(): Promise<void> {
  const kennung = randomUUID().slice(0, 8);
  const projektId = `diag-exp-projekt-${kennung}`;
  const zweitesProjektId = `diag-exp-projekt2-${kennung}`;
  const planId = `diag-exp-plan-${kennung}`;
  const punktId = `diag-exp-punkt-${kennung}`;
  let kategorieId = "";
  const vorlagenIds: string[] = [];

  let alleOk = true;

  try {
    for (const [id, name] of [
      [projektId, `Diagnose Export ${kennung}`],
      [zweitesProjektId, `Diagnose Export zweit ${kennung}`],
    ]) {
      await db
        .prepare("INSERT INTO projects (id, name, project_number) VALUES (?, ?, ?)")
        .run(id, name, `DEXP-${id.slice(-6).toUpperCase()}`);
    }
    await db
      .prepare("INSERT INTO plans (id, project_id, name) VALUES (?, ?, ?)")
      .run(planId, projektId, "Grundriss EG");

    const kategorie = await createCategory({
      projectId: projektId,
      name: "Mangel",
      shortCode: "MAN",
      fieldSchemaJson: JSON.stringify({
        version: 1,
        fields: [{ key: "hoehe", label: "Höhe", type: "text" }],
      }),
    });
    kategorieId = kategorie.id;

    await createPoint({
      id: punktId,
      planId,
      x: 0.5,
      y: 0.5,
      title: "Fuge unsauber",
      categoryId: kategorie.id,
      gewerk: "Trockenbau",
      customFields: JSON.stringify({ hoehe: "2,40 m" }),
    });
    const punkt = (await getPointById(punktId))!;

    const kontext = {
      kategorieName: (id: string | null) => (id === kategorie.id ? kategorie.name : undefined),
      personName: () => undefined,
      planName: (id: string) => (id === planId ? "Grundriss EG" : undefined),
    };

    // --- Wertezugriff ------------------------------------------------------
    alleOk =
      melde(
        exportWert(punkt, "status", kontext) === "Offen",
        "Status wird beschriftet ausgegeben",
        `"${exportWert(punkt, "status", kontext)}" statt "open"`
      ) && alleOk;

    alleOk =
      melde(
        exportWert(punkt, "category", kontext) === "Mangel" &&
          exportWert(punkt, "plan_name", kontext) === "Grundriss EG",
        "Kategorie und Zeichnung werden aufgelöst",
        `${exportWert(punkt, "category", kontext)} / ${exportWert(punkt, "plan_name", kontext)}`
      ) && alleOk;

    alleOk =
      melde(
        exportWert(punkt, alsKategoriefeld("hoehe"), kontext) === "2,40 m",
        "Kategoriefeld wird ausgegeben",
        exportWert(punkt, alsKategoriefeld("hoehe"), kontext)
      ) && alleOk;

    alleOk =
      melde(
        exportWert(punkt, "gibtsnicht", kontext) === "",
        "unbekannte Spalte bleibt leer statt zu scheitern",
        "leer"
      ) && alleOk;

    // --- Vorlage: Auswahl und Reihenfolge ---------------------------------
    const spalten = ["gewerk", "ticket_number", alsKategoriefeld("hoehe"), "status"];
    const vorlage = await createExportTemplate({
      projectId: projektId,
      name: "Kurzliste",
      columns: spalten,
    });
    vorlagenIds.push(vorlage.id);

    const gelesen = leseSpalten(vorlage.columns_json);
    alleOk =
      melde(
        gelesen.join("|") === spalten.join("|"),
        "Reihenfolge der Spalten bleibt erhalten",
        gelesen.join(", ")
      ) && alleOk;

    const zeile = gelesen.map((key) => exportWert(punkt, key, kontext));
    alleOk =
      melde(
        zeile.join("|") === "Trockenbau|" + punkt.ticket_number + "|2,40 m|Offen",
        "Zeile folgt der Vorlage",
        zeile.join(" | ")
      ) && alleOk;

    // --- Projektuebergreifende Vorlage ------------------------------------
    const global = await createExportTemplate({
      projectId: null,
      name: "Überall",
      columns: ["title"],
    });
    vorlagenIds.push(global.id);

    const imZweiten = await listExportTemplatesForProject(zweitesProjektId);
    alleOk =
      melde(
        imZweiten.some((v) => v.id === global.id) && !imZweiten.some((v) => v.id === vorlage.id),
        "übergreifende Vorlage gilt überall, projekteigene nicht",
        `${imZweiten.length} Vorlage(n) im zweiten Projekt`
      ) && alleOk;

    // --- Aendern und Archivieren ------------------------------------------
    const geaendert = await updateExportTemplate(vorlage.id, { columns: ["title", "status"] });
    alleOk =
      melde(
        leseSpalten(geaendert!.columns_json).join("|") === "title|status",
        "Vorlage lässt sich ändern",
        leseSpalten(geaendert!.columns_json).join(", ")
      ) && alleOk;

    await archiveExportTemplate(vorlage.id);
    const nachArchiv = await listExportTemplatesForProject(projektId);
    alleOk =
      melde(
        !nachArchiv.some((v) => v.id === vorlage.id),
        "archivierte Vorlage erscheint nicht mehr",
        `${nachArchiv.length} verbleibend`
      ) && alleOk;

    // --- Standardsatz bleibt gueltig --------------------------------------
    const unbekannt = STANDARD_EXPORT_SPALTEN.filter(
      (k) => !FESTE_EXPORT_SPALTEN.some((s) => s.key === k)
    );
    alleOk =
      melde(
        unbekannt.length === 0,
        "Standardspalten sind alle im Katalog",
        unbekannt.length === 0 ? `${STANDARD_EXPORT_SPALTEN.length} Spalten` : unbekannt.join(", ")
      ) && alleOk;
  } finally {
    for (const id of vorlagenIds) {
      await db.prepare("DELETE FROM export_templates WHERE id = ?").run(id);
    }
    await db.prepare("DELETE FROM point_status_history WHERE point_id = ?").run(punktId);
    await db.prepare("DELETE FROM notifications WHERE point_id = ?").run(punktId);
    await db.prepare("DELETE FROM points WHERE id = ?").run(punktId);
    await db.prepare("DELETE FROM ticket_number_counters WHERE project_id = ?").run(projektId);
    if (kategorieId) {
      await db.prepare("DELETE FROM categories WHERE id = ?").run(kategorieId);
    }
    await db.prepare("DELETE FROM plans WHERE id = ?").run(planId);
    for (const id of [projektId, zweitesProjektId]) {
      await db.prepare("DELETE FROM change_log WHERE project_id = ?").run(id);
      await db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    }
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
