CREATE TABLE point_comments (
  id TEXT PRIMARY KEY,
  point_id TEXT NOT NULL REFERENCES points(id),
  author_id TEXT REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT poi_now_iso()
);

CREATE INDEX idx_point_comments_point ON point_comments(point_id);
