import { db } from "../db/connection.js";

export interface ChangeLogEntry {
  seq: number;
  entity_type: string;
  entity_id: string;
  project_id: string;
  op: string;
  changed_at: string;
}

export async function recordChange(input: {
  entityType: string;
  entityId: string;
  projectId: string;
  op: "create" | "update" | "delete";
}): Promise<void> {
  await db
    .prepare(
      "INSERT INTO change_log (entity_type, entity_id, project_id, op) VALUES (?, ?, ?, ?)"
    )
    .run(input.entityType, input.entityId, input.projectId, input.op);
}

export async function getLatestSeq(projectId: string): Promise<number> {
  const row = await db
    .prepare("SELECT MAX(seq) AS maxseq FROM change_log WHERE project_id = ?")
    .get<{ maxseq: number | null }>(projectId);
  return row?.maxseq ?? 0;
}

export async function getChangesSince(
  projectId: string,
  since: number
): Promise<ChangeLogEntry[]> {
  return db
    .prepare(
      "SELECT * FROM change_log WHERE project_id = ? AND seq > ? ORDER BY seq ASC"
    )
    .all<ChangeLogEntry>(projectId, since);
}

export async function getAffectedPointIdsSince(
  projectId: string,
  since: number
): Promise<string[]> {
  const rows = await db
    .prepare(
      "SELECT DISTINCT entity_id FROM change_log WHERE project_id = ? AND seq > ? AND entity_type = 'point'"
    )
    .all<{ entity_id: string }>(projectId, since);
  return rows.map((r) => r.entity_id);
}
