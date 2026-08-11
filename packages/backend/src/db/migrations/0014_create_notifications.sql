CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  point_id TEXT REFERENCES points(id),
  recipient_id TEXT REFERENCES users(id),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT poi_now_iso(),
  read_at TEXT
);

CREATE INDEX idx_notifications_recipient ON notifications(recipient_id);
