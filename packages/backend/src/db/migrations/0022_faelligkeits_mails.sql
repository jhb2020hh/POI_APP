-- ===========================================================================
-- Taegliche Erinnerungsmails zu Faelligkeiten
-- ===========================================================================

-- Abmeldemoeglichkeit fuer den Einzelnen. Standard ist an: wer ein Ticket
-- zugewiesen bekommt, soll von der Frist erfahren, ohne das erst einschalten
-- zu muessen.
ALTER TABLE users ADD COLUMN email_benachrichtigungen INTEGER NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- Schutz gegen Doppelversand
-- ---------------------------------------------------------------------------
-- Jede verschickte Zeile bekommt einen fachlichen Schluessel, z. B.
--   faellig:heute:<punkt>:<empfaenger>:2026-08-14
-- Der Versand traegt den Schluessel *vor* dem Absenden ein und erkennt an
-- ON CONFLICT DO NOTHING, ob die Zeile schon einmal gemeldet wurde.
--
-- Warum ein eigener Schluessel und nicht "gab es heute schon eine Mail":
-- die Frist selbst steht mit drin. Wird ein Ticket verschoben, ist der
-- Schluessel ein anderer und die neue Frist wird wieder gemeldet - eine reine
-- Datumsabfrage haette das verschluckt.
--
-- Die Spalte bleibt NULL-bar: Benachrichtigungen aus der Anwendung (Zuweisung,
-- Kommentar) haben keinen solchen Schluessel. In Postgres kollidieren mehrere
-- NULL-Werte in einem UNIQUE-Index nicht.
ALTER TABLE notifications ADD COLUMN dedupe_key TEXT;

CREATE UNIQUE INDEX idx_notifications_dedupe_key
  ON notifications(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- Der Versand liest ausserdem Punkte mit gesetzter Frist. Ohne diesen Index
-- laeuft jeder naechtliche Lauf ueber die gesamte Tabelle.
CREATE INDEX idx_points_due_date
  ON points(due_date)
  WHERE due_date IS NOT NULL AND deleted = 0;
