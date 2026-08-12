import "../loadEnv.js";
import { randomUUID } from "node:crypto";
import { db, pool } from "../db/connection.js";
import { createCategory } from "../repositories/categoryRepository.js";
import { createPoint } from "../repositories/pointRepository.js";
import { createExportTemplate } from "../repositories/exportTemplateRepository.js";
import { addMember } from "../repositories/projectMemberRepository.js";
import { createNotification } from "../repositories/notificationRepository.js";
import {
  archiveProject,
  collectProjectFilePaths,
  deleteProjectCompletely,
  getProjectById,
  listArchivedProjects,
  listProjects,
  unarchiveProject,
} from "../repositories/projectRepository.js";

/**
 * Prueft Archivieren und endgueltiges Loeschen.
 *
 *   npm run diagnose:loeschen
 *
 * Beim Loeschen zaehlt jeder Rest: eine vergessene Tabelle hinterlaesst Zeilen,
 * die auf ein Projekt zeigen, das es nicht mehr gibt. Deshalb wird nach dem
 * Loeschen *jede* Tabelle einzeln nachgezaehlt, statt nur zu pruefen, ob das
 * Projekt weg ist.
 *
 * Ebenso wichtig: was NICHT geloescht werden darf. Projektuebergreifende
 * Kategorien und Exportvorlagen gehoeren allen Projekten - sie muessen den
 * Vorgang ueberstehen.
 *
 * Die Dateien in der Ablage sind nicht Teil dieses Laufs: das Skript laedt
 * keine hoch. Geprueft wird, dass ihre Pfade vor dem Loeschen vollstaendig
 * eingesammelt werden - danach waeren sie nicht mehr ermittelbar.
 */

function melde(ok: boolean, name: string, detail: string): boolean {
  console.log(`${ok ? "  OK  " : " FEHL "} ${name.padEnd(50)} ${detail}`);
  return ok;
}

async function zaehle(sql: string, ...params: string[]): Promise<number> {
  const zeile = await db.prepare(sql).get<{ anzahl: number }>(...params);
  return Number(zeile?.anzahl ?? 0);
}

async function main(): Promise<void> {
  const kennung = randomUUID().slice(0, 8);
  const projektId = `diag-del-projekt-${kennung}`;
  const planId = `diag-del-plan-${kennung}`;
  const ordnerId = `diag-del-ordner-${kennung}`;
  const punktId = `diag-del-punkt-${kennung}`;
  const anhangId = `diag-del-anhang-${kennung}`;
  let globaleKategorieId = "";
  let globaleVorlageId = "";

  let alleOk = true;
  let geloescht = false;

  try {
    // --- Ein Projekt mit allem, was daran haengen kann --------------------
    await db
      .prepare("INSERT INTO projects (id, name, project_number) VALUES (?, ?, ?)")
      .run(projektId, `Diagnose Löschen ${kennung}`, `DDEL-${kennung.toUpperCase()}`);
    await db
      .prepare("INSERT INTO plan_folders (id, project_id, name) VALUES (?, ?, ?)")
      .run(ordnerId, projektId, "Grundrisse");
    await db
      .prepare("INSERT INTO plans (id, project_id, name, file_path, folder_id) VALUES (?, ?, ?, ?, ?)")
      .run(planId, projektId, "Grundriss EG", `${planId}/plan.pdf`, ordnerId);

    const kategorie = await createCategory({ projectId: projektId, name: "Mangel", shortCode: "MAN" });
    await createPoint({
      id: punktId,
      planId,
      x: 0.5,
      y: 0.5,
      title: "Zu löschendes Ticket",
      categoryId: kategorie.id,
    });
    await db
      .prepare(
        `INSERT INTO point_attachments (id, point_id, file_path, file_name, mime_type, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(anhangId, punktId, `${punktId}/foto.jpg`, "foto.jpg", "image/jpeg", 1234);
    await db
      .prepare("INSERT INTO point_comments (id, point_id, body) VALUES (?, ?, ?)")
      .run(`diag-del-komm-${kennung}`, punktId, "Ein Kommentar");
    await createNotification({
      projectId: projektId,
      pointId: punktId,
      type: "diagnose",
      message: "Testbenachrichtigung",
    });
    await createExportTemplate({ projectId: projektId, name: "Eigene", columns: ["title"] });
    await db
      .prepare("INSERT INTO change_log (entity_type, entity_id, project_id, op) VALUES (?, ?, ?, ?)")
      .run("point", punktId, projektId, "create");

    const einAdmin = await db
      .prepare("SELECT id FROM users LIMIT 1")
      .get<{ id: string }>();
    if (einAdmin) await addMember(projektId, einAdmin.id);

    // Diese beiden gehoeren allen Projekten und muessen bleiben.
    const globaleKategorie = await createCategory({
      projectId: null,
      name: `Diagnose global ${kennung}`,
      shortCode: `G${kennung.slice(0, 3).toUpperCase()}`,
    });
    globaleKategorieId = globaleKategorie.id;
    const globaleVorlage = await createExportTemplate({
      projectId: null,
      name: `Diagnose global ${kennung}`,
      columns: ["title"],
    });
    globaleVorlageId = globaleVorlage.id;

    // --- Dateipfade muessen vor dem Loeschen vollstaendig sein ------------
    const pfade = await collectProjectFilePaths(projektId);
    alleOk =
      melde(
        pfade.plans.length === 1 && pfade.attachments.length === 1,
        "Dateipfade vor dem Löschen eingesammelt",
        `${pfade.plans.length} Zeichnung(en), ${pfade.attachments.length} Anhang/Anhänge`
      ) && alleOk;

    // --- Archivieren ------------------------------------------------------
    await archiveProject(projektId);
    const offen = await listProjects();
    const archiviert = await listArchivedProjects();
    alleOk =
      melde(
        !offen.some((p) => p.id === projektId) && archiviert.some((p) => p.id === projektId),
        "archiviertes Projekt wandert in die Archivliste",
        `${archiviert.length} im Archiv`
      ) && alleOk;

    await unarchiveProject(projektId);
    alleOk =
      melde(
        (await listProjects()).some((p) => p.id === projektId),
        "Zurückholen macht das Archivieren rückgängig",
        "wieder in der offenen Liste"
      ) && alleOk;
    await archiveProject(projektId);

    // --- Endgueltig loeschen ---------------------------------------------
    await deleteProjectCompletely(projektId);
    geloescht = true;

    const reste: [string, number][] = [
      ["projects", await zaehle("SELECT COUNT(*) AS anzahl FROM projects WHERE id = ?", projektId)],
      ["plans", await zaehle("SELECT COUNT(*) AS anzahl FROM plans WHERE project_id = ?", projektId)],
      ["plan_folders", await zaehle("SELECT COUNT(*) AS anzahl FROM plan_folders WHERE project_id = ?", projektId)],
      ["points", await zaehle("SELECT COUNT(*) AS anzahl FROM points WHERE id = ?", punktId)],
      ["point_attachments", await zaehle("SELECT COUNT(*) AS anzahl FROM point_attachments WHERE point_id = ?", punktId)],
      ["point_comments", await zaehle("SELECT COUNT(*) AS anzahl FROM point_comments WHERE point_id = ?", punktId)],
      ["point_status_history", await zaehle("SELECT COUNT(*) AS anzahl FROM point_status_history WHERE point_id = ?", punktId)],
      ["notifications", await zaehle("SELECT COUNT(*) AS anzahl FROM notifications WHERE project_id = ?", projektId)],
      ["categories", await zaehle("SELECT COUNT(*) AS anzahl FROM categories WHERE project_id = ?", projektId)],
      ["export_templates", await zaehle("SELECT COUNT(*) AS anzahl FROM export_templates WHERE project_id = ?", projektId)],
      ["project_members", await zaehle("SELECT COUNT(*) AS anzahl FROM project_members WHERE project_id = ?", projektId)],
      ["ticket_number_counters", await zaehle("SELECT COUNT(*) AS anzahl FROM ticket_number_counters WHERE project_id = ?", projektId)],
      ["change_log", await zaehle("SELECT COUNT(*) AS anzahl FROM change_log WHERE project_id = ?", projektId)],
    ];

    const uebrig = reste.filter(([, n]) => n > 0);
    alleOk =
      melde(
        uebrig.length === 0,
        `keine Reste in ${reste.length} Tabellen`,
        uebrig.length === 0
          ? "alle leer"
          : uebrig.map(([t, n]) => `${t}=${n}`).join(", ")
      ) && alleOk;

    // --- Was bleiben muss -------------------------------------------------
    const globalKategorieDa = await zaehle(
      "SELECT COUNT(*) AS anzahl FROM categories WHERE id = ?",
      globaleKategorieId
    );
    const globalVorlageDa = await zaehle(
      "SELECT COUNT(*) AS anzahl FROM export_templates WHERE id = ?",
      globaleVorlageId
    );
    alleOk =
      melde(
        globalKategorieDa === 1 && globalVorlageDa === 1,
        "projektübergreifende Vorlagen bleiben erhalten",
        `Kategorie ${globalKategorieDa}, Exportvorlage ${globalVorlageDa}`
      ) && alleOk;

    alleOk =
      melde(
        (await getProjectById(projektId)) === undefined,
        "Projekt ist nicht mehr auffindbar",
        "gelöscht"
      ) && alleOk;
  } finally {
    if (!geloescht) {
      // Der Lauf brach vor dem Loeschen ab - dann von Hand aufraeumen.
      try {
        await deleteProjectCompletely(projektId);
      } catch (error) {
        console.error("Aufraeumen fehlgeschlagen:", error);
      }
    }
    for (const [tabelle, id] of [
      ["categories", globaleKategorieId],
      ["export_templates", globaleVorlageId],
    ] as const) {
      if (id) await db.prepare(`DELETE FROM ${tabelle} WHERE id = ?`).run(id);
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
