ALTER TABLE projects ADD COLUMN project_number TEXT;
ALTER TABLE projects ADD COLUMN address TEXT;
ALTER TABLE projects ADD COLUMN customer TEXT;
ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'aktiv';
ALTER TABLE projects ADD COLUMN project_lead TEXT REFERENCES users(id);
