import { randomUUID } from "node:crypto";
import { db } from "../db/connection.js";

export interface PointHistoryEntry {
  id: string;
  point_id: string;
  changed_by: string | null;
  changed_at: string;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  source: string;
}

export function recordFieldChange(input: {
  pointId: string;
  changedBy?: string;
  fieldChanged: string;
  oldValue: string | null;
  newValue: string | null;
  source?: "online" | "offline-sync";
}): void {
  db.prepare(
    `INSERT INTO point_status_history
      (id, point_id, changed_by, field_changed, old_value, new_value, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    input.pointId,
    input.changedBy ?? null,
    input.fieldChanged,
    input.oldValue,
    input.newValue,
    input.source ?? "online"
  );
}

export function listHistoryForPoint(pointId: string): PointHistoryEntry[] {
  return db
    .prepare(
      "SELECT * FROM point_status_history WHERE point_id = ? ORDER BY changed_at ASC"
    )
    .all(pointId) as unknown as PointHistoryEntry[];
}
