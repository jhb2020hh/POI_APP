import { randomUUID } from "node:crypto";
import { db } from "../db/connection.js";

export interface PointComment {
  id: string;
  point_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

export function createComment(input: {
  pointId: string;
  authorId?: string;
  body: string;
}): PointComment {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO point_comments (id, point_id, author_id, body) VALUES (?, ?, ?, ?)`
  ).run(id, input.pointId, input.authorId ?? null, input.body);
  return getCommentById(id)!;
}

export function getCommentById(id: string): PointComment | undefined {
  return db.prepare("SELECT * FROM point_comments WHERE id = ?").get(id) as
    | PointComment
    | undefined;
}

export function listCommentsForPoint(pointId: string): PointComment[] {
  return db
    .prepare("SELECT * FROM point_comments WHERE point_id = ? ORDER BY created_at ASC")
    .all(pointId) as unknown as PointComment[];
}
