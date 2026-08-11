CREATE TABLE change_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  op TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_changelog_project_seq ON change_log(project_id, seq);
