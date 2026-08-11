import { randomUUID } from "node:crypto";
import { db } from "../db/connection.js";

export interface Plan {
  id: string;
  project_id: string;
  name: string;
  file_path: string | null;
  file_hash: string | null;
  page_count: number | null;
  bauabschnitt: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  folder_id: string | null;
}

export async function createPlan(input: {
  projectId: string;
  name: string;
  bauabschnitt?: string;
  uploadedBy?: string;
  filePath?: string;
  fileHash?: string;
}): Promise<Plan> {
  const id = randomUUID();
  await db
    .prepare(
      "INSERT INTO plans (id, project_id, name, bauabschnitt, uploaded_by, file_path, file_hash) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      id,
      input.projectId,
      input.name,
      input.bauabschnitt ?? null,
      input.uploadedBy ?? null,
      input.filePath ?? null,
      input.fileHash ?? null
    );
  return (await getPlanById(id))!;
}

export async function getPlanById(id: string): Promise<Plan | undefined> {
  return db.prepare("SELECT * FROM plans WHERE id = ?").get<Plan>(id);
}

export async function listPlansByProject(projectId: string): Promise<Plan[]> {
  return db
    .prepare("SELECT * FROM plans WHERE project_id = ? ORDER BY uploaded_at DESC")
    .all<Plan>(projectId);
}

export async function updatePlanFolder(
  id: string,
  folderId: string | null
): Promise<Plan | undefined> {
  await db.prepare("UPDATE plans SET folder_id = ? WHERE id = ?").run(folderId, id);
  return getPlanById(id);
}
