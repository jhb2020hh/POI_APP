ALTER TABLE categories ADD COLUMN short_code TEXT;
ALTER TABLE points ADD COLUMN ticket_number TEXT;

CREATE TABLE ticket_number_counters (
  project_id TEXT NOT NULL,
  category_code TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (project_id, category_code)
);
