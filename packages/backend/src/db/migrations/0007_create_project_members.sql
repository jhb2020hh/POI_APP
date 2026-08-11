CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, user_id)
);

UPDATE users SET role = 'tenant_admin' WHERE role = 'admin';
UPDATE users SET role = 'viewer' WHERE role NOT IN ('viewer', 'inspector', 'project_admin', 'tenant_admin');

INSERT OR IGNORE INTO project_members (project_id, user_id)
SELECT id, created_by FROM projects WHERE created_by IS NOT NULL;

