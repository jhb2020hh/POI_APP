CREATE TABLE point_status_history (
  id TEXT PRIMARY KEY,
  point_id TEXT NOT NULL REFERENCES points(id),
  changed_by TEXT REFERENCES users(id),
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  source TEXT NOT NULL DEFAULT 'online'
);

CREATE INDEX idx_point_history_point ON point_status_history(point_id);
