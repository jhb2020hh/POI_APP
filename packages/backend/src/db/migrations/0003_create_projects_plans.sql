CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT poi_now_iso(),
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  file_path TEXT,
  file_hash TEXT,
  page_count INTEGER,
  bauabschnitt TEXT,
  uploaded_by TEXT REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT poi_now_iso()
);

CREATE INDEX idx_plans_project ON plans(project_id);
