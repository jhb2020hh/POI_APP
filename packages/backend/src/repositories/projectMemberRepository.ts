import { db } from "../db/connection.js";

export interface ProjectMember {
  project_id: string;
  user_id: string;
  added_at: string;
}

export function isMember(projectId: string, userId: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?")
    .get(projectId, userId);
  return Boolean(row);
}

export function addMember(projectId: string, userId: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)"
  ).run(projectId, userId);
}

export function removeMember(projectId: string, userId: string): void {
  db.prepare(
    "DELETE FROM project_members WHERE project_id = ? AND user_id = ?"
  ).run(projectId, userId);
}

export function listMembersForProject(projectId: string): ProjectMember[] {
  return db
    .prepare("SELECT * FROM project_members WHERE project_id = ?")
    .all(projectId) as unknown as ProjectMember[];
}
