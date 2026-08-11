-- Liefert einen Zeitstempel im selben Format, das der Anwendungscode ueber
-- new Date().toISOString() erzeugt. Wichtig, weil Zeitstempel im Schema als TEXT
-- liegen und an mehreren Stellen als Zeichenkette verglichen werden
-- (z. B. created_at >= ? in den Ticketfiltern). Ein abweichendes Format wuerde
-- dort still falsche Ergebnisse liefern.
CREATE OR REPLACE FUNCTION poi_now_iso() RETURNS TEXT
LANGUAGE SQL STABLE AS $$
  SELECT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT poi_now_iso()
);
