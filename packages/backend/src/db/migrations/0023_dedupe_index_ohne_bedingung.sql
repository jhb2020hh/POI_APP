-- Korrektur zu 0022: der Eindeutigkeitsindex auf notifications.dedupe_key war
-- partiell (WHERE dedupe_key IS NOT NULL) angelegt.
--
-- Postgres zieht einen partiellen Index nur dann als Schiedsrichter fuer
-- ON CONFLICT heran, wenn das INSERT dieselbe Bedingung noch einmal auffuehrt.
-- Ohne sie bricht der Versand mit 42P10 ab ("no unique or exclusion constraint
-- matching the ON CONFLICT specification") - und zwar erst beim echten Lauf,
-- weil der Trockenlauf gar nichts eintraegt.
--
-- Die Bedingung war ausserdem unnoetig: sie sollte erlauben, dass die
-- Benachrichtigungen aus der Anwendung (Zuweisung, Kommentar) ohne Schluessel
-- nebeneinander stehen. Das tun sie in einem gewoehnlichen UNIQUE-Index
-- ohnehin, weil NULL dort als von jedem anderen NULL verschieden gilt.
DROP INDEX IF EXISTS idx_notifications_dedupe_key;

CREATE UNIQUE INDEX idx_notifications_dedupe_key
  ON notifications(dedupe_key);
