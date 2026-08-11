import { db } from "../db/connection.js";

export interface ProjectMember {
  project_id: string;
  user_id: string;
  added_at: string;
}

export async function isMember(projectId: string, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?")
    .get(projectId, userId);
  return Boolean(row);
}

export async function addMember(projectId: string, userId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO project_members (project_id, user_id) VALUES (?, ?)
       ON CONFLICT (project_id, user_id) DO NOTHING`
    )
    .run(projectId, userId);
}

export async function removeMember(projectId: string, userId: string): Promise<void> {
  await db
    .prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?")
    .run(projectId, userId);
}

export async function listMembersForProject(
  projectId: string
): Promise<ProjectMember[]> {
  return db
    .prepare("SELECT * FROM project_members WHERE project_id = ?")
    .all<ProjectMember>(projectId);
}
