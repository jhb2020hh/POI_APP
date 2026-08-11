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

export function createPlan(input: {
  projectId: string;
  name: string;
  bauabschnitt?: string;
  uploadedBy?: string;
  filePath?: string;
  fileHash?: string;
}): Plan {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO plans (id, project_id, name, bauabschnitt, uploaded_by, file_path, file_hash) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    input.projectId,
    input.name,
    input.bauabschnitt ?? null,
    input.uploadedBy ?? null,
    input.filePath ?? null,
    input.fileHash ?? null
  );
  return getPlanById(id)!;
}

export function getPlanById(id: string): Plan | undefined {
  return db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as
    | Plan
    | undefined;
}

export function listPlansByProject(projectId: string): Plan[] {
  return db
    .prepare("SELECT * FROM plans WHERE project_id = ? ORDER BY uploaded_at DESC")
    .all(projectId) as unknown as Plan[];
}

export function updatePlanFolder(id: string, folderId: string | null): Plan | undefined {
  db.prepare("UPDATE plans SET folder_id = ? WHERE id = ?").run(folderId, id);
  return getPlanById(id);
}
