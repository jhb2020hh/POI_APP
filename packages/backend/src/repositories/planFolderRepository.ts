import { randomUUID } from "node:crypto";
import { db } from "../db/connection.js";

export interface PlanFolder {
  id: string;
  project_id: string;
  parent_folder_id: string | null;
  name: string;
  created_by: string | null;
  created_at: string;
}

export function createFolder(input: {
  projectId: string;
  parentFolderId?: string | null;
  name: string;
  createdBy?: string;
}): PlanFolder {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO plan_folders (id, project_id, parent_folder_id, name, created_by) VALUES (?, ?, ?, ?, ?)"
  ).run(id, input.projectId, input.parentFolderId ?? null, input.name, input.createdBy ?? null);
  return getFolderById(id)!;
}

export function getFolderById(id: string): PlanFolder | undefined {
  return db.prepare("SELECT * FROM plan_folders WHERE id = ?").get(id) as PlanFolder | undefined;
}

export function listFoldersByProject(projectId: string): PlanFolder[] {
  return db
    .prepare("SELECT * FROM plan_folders WHERE project_id = ? ORDER BY name ASC")
    .all(projectId) as unknown as PlanFolder[];
}

export function renameFolder(id: string, name: string): PlanFolder | undefined {
  db.prepare("UPDATE plan_folders SET name = ? WHERE id = ?").run(name, id);
  return getFolderById(id);
}

export function moveFolder(id: string, parentFolderId: string | null): PlanFolder | undefined {
  db.prepare("UPDATE plan_folders SET parent_folder_id = ? WHERE id = ?").run(parentFolderId, id);
  return getFolderById(id);
}

export function folderHasChildren(id: string): boolean {
  const childFolder = db
    .prepare("SELECT id FROM plan_folders WHERE parent_folder_id = ? LIMIT 1")
    .get(id);
  if (childFolder) return true;
  const childPlan = db.prepare("SELECT id FROM plans WHERE folder_id = ? LIMIT 1").get(id);
  return Boolean(childPlan);
}

export function deleteFolder(id: string): boolean {
  const result = db.prepare("DELETE FROM plan_folders WHERE id = ?").run(id);
  return result.changes > 0;
}
