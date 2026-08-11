CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#e63946',
  glyph TEXT NOT NULL DEFAULT '!',
  field_schema_json TEXT NOT NULL DEFAULT '{"version":1,"fields":[]}',
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT poi_now_iso(),
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_categories_project ON categories(project_id);

INSERT INTO categories (id, project_id, name, color, glyph, field_schema_json)
VALUES
  ('cat-defect', NULL, 'Mangel', '#e63946', '!', '{"version":1,"fields":[]}'),
  ('cat-clarification', NULL, 'Unklar / Klärungsbedarf', '#ffd23f', '?', '{"version":1,"fields":[]}');
