import { randomUUID } from "node:crypto";
import { db } from "../db/connection.js";

export interface PointComment {
  id: string;
  point_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

export async function createComment(input: {
  pointId: string;
  authorId?: string;
  body: string;
}): Promise<PointComment> {
  const id = randomUUID();
  await db
    .prepare(
      `INSERT INTO point_comments (id, point_id, author_id, body) VALUES (?, ?, ?, ?)`
    )
    .run(id, input.pointId, input.authorId ?? null, input.body);
  return (await getCommentById(id))!;
}

export async function getCommentById(id: string): Promise<PointComment | undefined> {
  return db.prepare("SELECT * FROM point_comments WHERE id = ?").get<PointComment>(id);
}

export async function listCommentsForPoint(pointId: string): Promise<PointComment[]> {
  return db
    .prepare("SELECT * FROM point_comments WHERE point_id = ? ORDER BY created_at ASC")
    .all<PointComment>(pointId);
}
