CREATE TABLE point_attachments (
  id TEXT PRIMARY KEY,
  point_id TEXT NOT NULL REFERENCES points(id),
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_by TEXT REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT poi_now_iso()
);

CREATE INDEX idx_point_attachments_point ON point_attachments(point_id);
