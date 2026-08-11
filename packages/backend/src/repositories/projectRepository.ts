import { randomUUID } from "node:crypto";
import { db } from "../db/connection.js";

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

export function createProject(input: {
  name: string;
  description?: string;
  createdBy?: string;
  projectNumber?: string;
  address?: string;
  customer?: string;
  status?: string;
  projectLead?: string;
}): Project {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO projects
      (id, name, description, created_by, project_number, address, customer, status, project_lead)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
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
  return getProjectById(id)!;
}

export function findProjectByNumber(projectNumber: string): Project | undefined {
  return db.prepare("SELECT * FROM projects WHERE project_number = ? AND archived = 0").get(projectNumber) as
    | Project
    | undefined;
}

export function getProjectById(id: string): Project | undefined {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | Project
    | undefined;
}

export function listProjects(): Project[] {
  return db
    .prepare("SELECT * FROM projects WHERE archived = 0 ORDER BY created_at DESC")
    .all() as unknown as Project[];
}

export function listProjectsForUser(userId: string): Project[] {
  return db
    .prepare(
      `SELECT p.* FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       WHERE pm.user_id = ? AND p.archived = 0
       ORDER BY p.created_at DESC`
    )
    .all(userId) as unknown as Project[];
}

export function archiveProject(id: string): boolean {
  const result = db.prepare("UPDATE projects SET archived = 1 WHERE id = ?").run(id);
  return result.changes > 0;
}

export function updateProjectDates(
  id: string,
  input: { baubeginn?: string | null; fertigstellung?: string | null }
): Project | undefined {
  const current = getProjectById(id);
  if (!current) return undefined;
  const baubeginn = "baubeginn" in input ? input.baubeginn ?? null : current.baubeginn;
  const fertigstellung =
    "fertigstellung" in input ? input.fertigstellung ?? null : current.fertigstellung;
  db.prepare("UPDATE projects SET baubeginn = ?, fertigstellung = ? WHERE id = ?").run(
    baubeginn,
    fertigstellung,
    id
  );
  return getProjectById(id);
}
