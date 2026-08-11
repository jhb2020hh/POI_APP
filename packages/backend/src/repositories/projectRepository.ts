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

export async function archiveProject(id: string): Promise<boolean> {
  const result = await db
    .prepare("UPDATE projects SET archived = 1 WHERE id = ?")
    .run(id);
  return result.changes > 0;
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
