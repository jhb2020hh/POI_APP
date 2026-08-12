import { randomUUID } from "node:crypto";
import { db, pool } from "../db/connection.js";

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  archived: number;
  project_number: string | null;
  address: string | null;
  customer: string | null;
  status: string;
  project_lead: string | null;
  baubeginn: string | null;
  fertigstellung: string | null;
}

export async function createProject(input: {
  name: string;
  description?: string;
  createdBy?: string;
  projectNumber?: string;
  address?: string;
  customer?: string;
  status?: string;
  projectLead?: string;
}): Promise<Project> {
  const id = randomUUID();
  await db
    .prepare(
      `INSERT INTO projects
        (id, name, description, created_by, project_number, address, customer, status, project_lead)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.name,
      input.description ?? null,
      input.createdBy ?? null,
      input.projectNumber ?? null,
      input.address ?? null,
      input.customer ?? null,
      input.status ?? "aktiv",
      input.projectLead ?? null
    );
  return (await getProjectById(id))!;
}

export async function findProjectByNumber(
  projectNumber: string
): Promise<Project | undefined> {
  return db
    .prepare("SELECT * FROM projects WHERE project_number = ? AND archived = 0")
    .get<Project>(projectNumber);
}

export async function getProjectById(id: string): Promise<Project | undefined> {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get<Project>(id);
}

export async function listProjects(): Promise<Project[]> {
  return db
    .prepare("SELECT * FROM projects WHERE archived = 0 ORDER BY created_at DESC")
    .all<Project>();
}

export async function listProjectsForUser(userId: string): Promise<Project[]> {
  return db
    .prepare(
      `SELECT p.* FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       WHERE pm.user_id = ? AND p.archived = 0
       ORDER BY p.created_at DESC`
    )
    .all<Project>(userId);
}

export async function listArchivedProjects(): Promise<Project[]> {
  return db
    .prepare("SELECT * FROM projects WHERE archived = 1 ORDER BY created_at DESC")
    .all<Project>();
}

export async function archiveProject(id: string): Promise<boolean> {
  const result = await db
    .prepare("UPDATE projects SET archived = 1 WHERE id = ?")
    .run(id);
  return result.changes > 0;
}

export async function unarchiveProject(id: string): Promise<boolean> {
  const result = await db
    .prepare("UPDATE projects SET archived = 0 WHERE id = ?")
    .run(id);
  return result.changes > 0;
}

/**
 * Sammelt die Pfade aller Dateien eines Projekts, getrennt nach Ablage.
 *
 * Wird *vor* dem Loeschen der Zeilen aufgerufen: danach waere nicht mehr
 * feststellbar, welche Dateien zu diesem Projekt gehoerten.
 */
export async function collectProjectFilePaths(
  projectId: string
): Promise<{ plans: string[]; attachments: string[] }> {
  const planRows = await db
    .prepare(
      "SELECT file_path FROM plans WHERE project_id = ? AND file_path IS NOT NULL"
    )
    .all<{ file_path: string }>(projectId);

  const attachmentRows = await db
    .prepare(
      `SELECT point_attachments.file_path
       FROM point_attachments
       JOIN points ON points.id = point_attachments.point_id
       JOIN plans  ON plans.id = points.plan_id
       WHERE plans.project_id = ?`
    )
    .all<{ file_path: string }>(projectId);

  return {
    plans: planRows.map((r) => r.file_path),
    attachments: attachmentRows.map((r) => r.file_path),
  };
}

/**
 * Loescht ein Projekt endgueltig - mit allem, was daran haengt.
 *
 * Reihenfolge ergibt sich aus den Fremdschluesseln: was auf etwas zeigt, geht
 * zuerst. Alles in *einer* Transaktion, sonst bliebe bei einem Abbruch
 * mittendrin ein halb geloeschtes Projekt zurueck - Tickets ohne Zeichnung,
 * Anhaenge ohne Ticket.
 *
 * Bewusst ueber pool.connect() statt ueber db.prepare(): der Adapter reicht
 * jede Anweisung einzeln an den Pool weiter, und bei Poolgroesse 1 waere das
 * zwar praktisch dieselbe Verbindung, aber eben nicht garantiert. BEGIN und
 * COMMIT muessen nachweislich auf derselben Verbindung liegen.
 *
 * Projektuebergreifende Kategorien und Exportvorlagen (project_id IS NULL)
 * bleiben stehen - sie gehoeren allen Projekten, nicht diesem.
 */
export async function deleteProjectCompletely(projectId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Ueber die Zeichnungen erreichbare Daten zuerst.
    await client.query(
      `DELETE FROM point_attachments WHERE point_id IN (
         SELECT points.id FROM points
         JOIN plans ON plans.id = points.plan_id
         WHERE plans.project_id = $1)`,
      [projectId]
    );
    await client.query(
      `DELETE FROM point_comments WHERE point_id IN (
         SELECT points.id FROM points
         JOIN plans ON plans.id = points.plan_id
         WHERE plans.project_id = $1)`,
      [projectId]
    );
    await client.query(
      `DELETE FROM point_status_history WHERE point_id IN (
         SELECT points.id FROM points
         JOIN plans ON plans.id = points.plan_id
         WHERE plans.project_id = $1)`,
      [projectId]
    );
    // Benachrichtigungen haengen sowohl am Projekt als auch an einzelnen
    // Punkten - die Bedingung deckt beide Wege ab.
    await client.query(
      `DELETE FROM notifications
       WHERE project_id = $1
          OR point_id IN (
            SELECT points.id FROM points
            JOIN plans ON plans.id = points.plan_id
            WHERE plans.project_id = $1)`,
      [projectId]
    );
    await client.query(
      `DELETE FROM points WHERE plan_id IN (SELECT id FROM plans WHERE project_id = $1)`,
      [projectId]
    );

    await client.query("DELETE FROM plans WHERE project_id = $1", [projectId]);
    await client.query("DELETE FROM plan_folders WHERE project_id = $1", [projectId]);
    await client.query("DELETE FROM categories WHERE project_id = $1", [projectId]);
    await client.query("DELETE FROM export_templates WHERE project_id = $1", [projectId]);
    await client.query("DELETE FROM project_members WHERE project_id = $1", [projectId]);
    await client.query("DELETE FROM ticket_number_counters WHERE project_id = $1", [projectId]);
    await client.query("DELETE FROM change_log WHERE project_id = $1", [projectId]);
    await client.query("DELETE FROM projects WHERE id = $1", [projectId]);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateProjectDates(
  id: string,
  input: { baubeginn?: string | null; fertigstellung?: string | null }
): Promise<Project | undefined> {
  const current = await getProjectById(id);
  if (!current) return undefined;
  const baubeginn = "baubeginn" in input ? input.baubeginn ?? null : current.baubeginn;
  const fertigstellung =
    "fertigstellung" in input ? input.fertigstellung ?? null : current.fertigstellung;
  await db
    .prepare("UPDATE projects SET baubeginn = ?, fertigstellung = ? WHERE id = ?")
    .run(baubeginn, fertigstellung, id);
  return getProjectById(id);
}
