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

export async function createNotification(input: {
  projectId: string;
  pointId?: string;
  recipientId?: string;
  type: string;
  message: string;
}): Promise<Notification> {
  const id = randomUUID();
  await db
    .prepare(
      `INSERT INTO notifications (id, project_id, point_id, recipient_id, type, message)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.projectId,
      input.pointId ?? null,
      input.recipientId ?? null,
      input.type,
      input.message
    );
  return (await db
    .prepare("SELECT * FROM notifications WHERE id = ?")
    .get<Notification>(id))!;
}
