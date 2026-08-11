CREATE TABLE points (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  page_number INTEGER NOT NULL DEFAULT 1,
  x REAL NOT NULL,
  y REAL NOT NULL,
  point_type TEXT NOT NULL DEFAULT 'defect',
  status TEXT NOT NULL DEFAULT 'open',
  title TEXT NOT NULL,
  description TEXT,
  bauabschnitt TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_points_plan ON points(plan_id);
CREATE INDEX idx_points_updated ON points(updated_at);
