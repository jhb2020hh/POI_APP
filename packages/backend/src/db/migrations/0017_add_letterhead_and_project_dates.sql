CREATE TABLE company_letterhead (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  firma_name TEXT NOT NULL DEFAULT '',
  adresse_zeile1 TEXT NOT NULL DEFAULT '',
  plz_ort TEXT NOT NULL DEFAULT '',
  telefon TEXT NOT NULL DEFAULT '',
  fax TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  geschaeftsfuehrer TEXT NOT NULL DEFAULT '',
  sitz_gesellschaft TEXT NOT NULL DEFAULT '',
  handelsregister TEXT NOT NULL DEFAULT '',
  ust_idnr TEXT NOT NULL DEFAULT ''
);

INSERT INTO company_letterhead (id) VALUES (1);

ALTER TABLE projects ADD COLUMN baubeginn TEXT;
ALTER TABLE projects ADD COLUMN fertigstellung TEXT;
