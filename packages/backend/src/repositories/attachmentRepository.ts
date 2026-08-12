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

export async function createAttachment(input: {
  pointId: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy?: string;
}): Promise<Attachment> {
  const id = randomUUID();
  await db
    .prepare(
      `INSERT INTO point_attachments (id, point_id, file_path, file_name, mime_type, size_bytes, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.pointId,
      input.filePath,
      input.fileName,
      input.mimeType,
      input.sizeBytes,
      input.uploadedBy ?? null
    );
  return (await getAttachmentById(id))!;
}

export async function getAttachmentById(id: string): Promise<Attachment | undefined> {
  return db
    .prepare("SELECT * FROM point_attachments WHERE id = ?")
    .get<Attachment>(id);
}

export async function listAttachmentsForPoint(pointId: string): Promise<Attachment[]> {
  return db
    .prepare(
      "SELECT * FROM point_attachments WHERE point_id = ? ORDER BY uploaded_at ASC"
    )
    .all<Attachment>(pointId);
}

/**
 * Anhang samt der Angaben des Tickets, an dem er haengt.
 *
 * Die Galerie zeigt sie im Infofenster und sortiert danach. Sie hier
 * mitzuliefern spart je Bild eine eigene Abfrage - bei einigen hundert Fotos
 * waeren das einige hundert Anfragen.
 */
export interface AttachmentWithPoint extends Attachment {
  plan_id: string;
  plan_name: string | null;
  point_title: string;
  category_id: string | null;
  ticket_number: string | null;
  point_status: string;
  assigned_to: string | null;
  gewerk: string | null;
}

export async function listAttachmentsByProject(
  projectId: string,
  filters?: { assignedTo?: string }
): Promise<AttachmentWithPoint[]> {
  const conditions = ["plans.project_id = ?", "points.deleted = 0"];
  const params: (string | number)[] = [projectId];
  if (filters?.assignedTo) {
    conditions.push("points.assigned_to = ?");
    params.push(filters.assignedTo);
  }
  return db
    .prepare(
      `SELECT point_attachments.*,
              points.plan_id       AS plan_id,
              plans.name           AS plan_name,
              points.title         AS point_title,
              points.category_id   AS category_id,
              points.ticket_number AS ticket_number,
              points.status        AS point_status,
              points.assigned_to   AS assigned_to,
              points.gewerk        AS gewerk
       FROM point_attachments
       JOIN points ON points.id = point_attachments.point_id
       JOIN plans ON plans.id = points.plan_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY point_attachments.uploaded_at DESC`
    )
    .all<AttachmentWithPoint>(...params);
}
