CREATE TABLE plan_folders (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  parent_folder_id TEXT REFERENCES plan_folders(id),
  name TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT poi_now_iso()
);

CREATE INDEX idx_plan_folders_project ON plan_folders(project_id);
CREATE INDEX idx_plan_folders_parent ON plan_folders(parent_folder_id);

ALTER TABLE plans ADD COLUMN folder_id TEXT REFERENCES plan_folders(id);
