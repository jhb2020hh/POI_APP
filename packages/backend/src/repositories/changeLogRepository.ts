import { db } from "../db/connection.js";

export interface ChangeLogEntry {
  seq: number;
  entity_type: string;
  entity_id: string;
  project_id: string;
  op: string;
  changed_at: string;
}

export function recordChange(input: {
  entityType: string;
  entityId: string;
  projectId: string;
  op: "create" | "update" | "delete";
}): void {
  db.prepare(
    "INSERT INTO change_log (entity_type, entity_id, project_id, op) VALUES (?, ?, ?, ?)"
  ).run(input.entityType, input.entityId, input.projectId, input.op);
}

export function getLatestSeq(projectId: string): number {
  const row = db
    .prepare(
      "SELECT MAX(seq) AS maxSeq FROM change_log WHERE project_id = ?"
    )
    .get(projectId) as { maxSeq: number | null };
  return row.maxSeq ?? 0;
}

export function getChangesSince(
  projectId: string,
  since: number
): ChangeLogEntry[] {
  return db
    .prepare(
      "SELECT * FROM change_log WHERE project_id = ? AND seq > ? ORDER BY seq ASC"
    )
    .all(projectId, since) as unknown as ChangeLogEntry[];
}

export function getAffectedPointIdsSince(
  projectId: string,
  since: number
): string[] {
  const rows = db
    .prepare(
      "SELECT DISTINCT entity_id FROM change_log WHERE project_id = ? AND seq > ? AND entity_type = 'point'"
    )
    .all(projectId, since) as { entity_id: string }[];
  return rows.map((r) => r.entity_id);
}
