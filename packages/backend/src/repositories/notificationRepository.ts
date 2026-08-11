import { randomUUID } from "node:crypto";
import { db } from "../db/connection.js";

export interface Notification {
  id: string;
  project_id: string;
  point_id: string | null;
  recipient_id: string | null;
  type: string;
  message: string;
  created_at: string;
  read_at: string | null;
}

export function createNotification(input: {
  projectId: string;
  pointId?: string;
  recipientId?: string;
  type: string;
  message: string;
}): Notification {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO notifications (id, project_id, point_id, recipient_id, type, message)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.projectId,
    input.pointId ?? null,
    input.recipientId ?? null,
    input.type,
    input.message
  );
  return db.prepare("SELECT * FROM notifications WHERE id = ?").get(id) as unknown as Notification;
}
