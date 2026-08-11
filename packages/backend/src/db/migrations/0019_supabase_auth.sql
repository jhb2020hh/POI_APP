-- Passwoerter liegen ab jetzt bei Supabase Auth, nicht mehr in dieser Tabelle.
-- `users` ist damit reine Profiltabelle: users.id traegt dieselbe UUID wie der
-- zugehoerige Eintrag in auth.users.
--
-- Bewusst kein Fremdschluessel auf auth.users: dessen id ist vom Typ uuid,
-- users.id im gesamten uebrigen Schema dagegen TEXT (alle Verweise wie
-- points.created_by, project_members.user_id haengen daran). Ein Typwechsel
-- wuerde jede dieser Spalten mitziehen. Die Kopplung wird stattdessen beim
-- Anlegen und Loeschen von Nutzern im Anwendungscode gehalten.
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;

ALTER TABLE users ALTER COLUMN role SET DEFAULT 'extern';
