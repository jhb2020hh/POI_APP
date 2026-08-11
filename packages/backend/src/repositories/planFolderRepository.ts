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

export async function createFolder(input: {
  projectId: string;
  parentFolderId?: string | null;
  name: string;
  createdBy?: string;
}): Promise<PlanFolder> {
  const id = randomUUID();
  await db
    .prepare(
      "INSERT INTO plan_folders (id, project_id, parent_folder_id, name, created_by) VALUES (?, ?, ?, ?, ?)"
    )
    .run(
      id,
      input.projectId,
      input.parentFolderId ?? null,
      input.name,
      input.createdBy ?? null
    );
  return (await getFolderById(id))!;
}

export async function getFolderById(id: string): Promise<PlanFolder | undefined> {
  return db.prepare("SELECT * FROM plan_folders WHERE id = ?").get<PlanFolder>(id);
}

export async function listFoldersByProject(projectId: string): Promise<PlanFolder[]> {
  return db
    .prepare("SELECT * FROM plan_folders WHERE project_id = ? ORDER BY name ASC")
    .all<PlanFolder>(projectId);
}

export async function renameFolder(
  id: string,
  name: string
): Promise<PlanFolder | undefined> {
  await db.prepare("UPDATE plan_folders SET name = ? WHERE id = ?").run(name, id);
  return getFolderById(id);
}

export async function moveFolder(
  id: string,
  parentFolderId: string | null
): Promise<PlanFolder | undefined> {
  await db
    .prepare("UPDATE plan_folders SET parent_folder_id = ? WHERE id = ?")
    .run(parentFolderId, id);
  return getFolderById(id);
}

export async function folderHasChildren(id: string): Promise<boolean> {
  const childFolder = await db
    .prepare("SELECT id FROM plan_folders WHERE parent_folder_id = ? LIMIT 1")
    .get(id);
  if (childFolder) return true;
  const childPlan = await db
    .prepare("SELECT id FROM plans WHERE folder_id = ? LIMIT 1")
    .get(id);
  return Boolean(childPlan);
}

export async function deleteFolder(id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM plan_folders WHERE id = ?").run(id);
  return result.changes > 0;
}
