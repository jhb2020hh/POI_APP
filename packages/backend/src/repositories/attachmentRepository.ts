import { randomUUID } from "node:crypto";
import { db } from "../db/connection.js";

export interface Attachment {
  id: string;
  point_id: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  uploaded_at: string;
}

export function createAttachment(input: {
  pointId: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy?: string;
}): Attachment {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO point_attachments (id, point_id, file_path, file_name, mime_type, size_bytes, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.pointId,
    input.filePath,
    input.fileName,
    input.mimeType,
    input.sizeBytes,
    input.uploadedBy ?? null
  );
  return getAttachmentById(id)!;
}

export function getAttachmentById(id: string): Attachment | undefined {
  return db.prepare("SELECT * FROM point_attachments WHERE id = ?").get(id) as
    | Attachment
    | undefined;
}

export function listAttachmentsForPoint(pointId: string): Attachment[] {
  return db
    .prepare("SELECT * FROM point_attachments WHERE point_id = ? ORDER BY uploaded_at ASC")
    .all(pointId) as unknown as Attachment[];
}

export interface AttachmentWithPoint extends Attachment {
  plan_id: string;
  point_title: string;
  category_id: string | null;
}

export function listAttachmentsByProject(
  projectId: string,
  filters?: { assignedTo?: string }
): AttachmentWithPoint[] {
  const conditions = ["plans.project_id = ?", "points.deleted = 0"];
  const params: (string | number)[] = [projectId];
  if (filters?.assignedTo) {
    conditions.push("points.assigned_to = ?");
    params.push(filters.assignedTo);
  }
  return db
    .prepare(
      `SELECT point_attachments.*, points.plan_id AS plan_id, points.title AS point_title, points.category_id AS category_id
       FROM point_attachments
       JOIN points ON points.id = point_attachments.point_id
       JOIN plans ON plans.id = points.plan_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY point_attachments.uploaded_at DESC`
    )
    .all(...params) as unknown as AttachmentWithPoint[];
}
