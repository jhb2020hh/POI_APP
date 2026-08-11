ALTER TABLE points ADD COLUMN priority TEXT;
ALTER TABLE points ADD COLUMN assigned_to TEXT REFERENCES users(id);
ALTER TABLE points ADD COLUMN due_date TEXT;
ALTER TABLE points ADD COLUMN gewerk TEXT;
ALTER TABLE points ADD COLUMN raum_bereich TEXT;
