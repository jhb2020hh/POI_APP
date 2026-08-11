-- ===========================================================================
-- Row Level Security
-- ===========================================================================
-- Supabase veroeffentlicht jede Tabelle des public-Schemas automatisch ueber
-- PostgREST. Ohne RLS koennte damit jeder, der den (oeffentlichen) anon-Key
-- kennt, die komplette Datenbank an der API vorbei auslesen und beschreiben.
--
-- Deshalb wird RLS auf allen Tabellen eingeschaltet. Ohne passende Policy
-- bedeutet das: kein Zugriff fuer anon und authenticated. Die Anwendung selbst
-- ist davon nicht betroffen, weil sie mit dem service_role-Schluessel arbeitet,
-- der RLS grundsaetzlich umgeht - die Rechtepruefung bleibt unveraendert in
-- src/authorization.ts.
--
-- Einzige Ausnahme ist `points`: dort wird gezielt Lesen erlaubt, weil Supabase
-- Realtime die Aenderungen sonst nicht an die Clients ausliefern darf.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE points ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_letterhead ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_number_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE _migrations ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- Sichtbarkeitsregel fuer Realtime
-- ===========================================================================
-- SECURITY DEFINER, weil die Funktion users/plans/project_members lesen muss -
-- Tabellen, die fuer den aufrufenden Nutzer selbst gesperrt sind. Das feste
-- search_path verhindert, dass ueber eine untergeschobene Tabelle gleichen
-- Namens etwas anderes ausgefuehrt wird.
--
-- Die Regel bildet dieselbe Logik ab wie canAccessProject() und
-- scopedAssignedTo() in src/authorization.ts:
--   - admin sieht alles
--   - Projektmitglieder sehen die Punkte ihrer Projekte
--   - extern sieht davon nur die ihm zugewiesenen Tickets
CREATE OR REPLACE FUNCTION poi_can_read_point(p_plan_id TEXT, p_assigned_to TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN auth.uid() IS NULL THEN FALSE
      WHEN EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = auth.uid()::text AND u.role = 'admin'
      ) THEN TRUE
      ELSE
        EXISTS (
          SELECT 1
          FROM plans pl
          JOIN project_members pm ON pm.project_id = pl.project_id
          WHERE pl.id = p_plan_id
            AND pm.user_id = auth.uid()::text
        )
        AND (
          NOT EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = auth.uid()::text AND u.role = 'extern'
          )
          OR p_assigned_to = auth.uid()::text
        )
    END
$$;

REVOKE ALL ON FUNCTION poi_can_read_point(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION poi_can_read_point(TEXT, TEXT) TO authenticated;

CREATE POLICY points_select_for_members ON points
  FOR SELECT
  TO authenticated
  USING (poi_can_read_point(plan_id, assigned_to));

-- ===========================================================================
-- Realtime
-- ===========================================================================
-- REPLICA IDENTITY FULL sorgt dafuer, dass bei UPDATE auch die alten Werte im
-- Replikationsstrom stehen. Das wird gebraucht, weil ein geloeschtes Ticket
-- hier ein UPDATE auf deleted = 1 ist: ohne die alten Werte koennte der Client
-- nicht erkennen, dass der Punkt vorher sichtbar war.
ALTER TABLE points REPLICA IDENTITY FULL;

-- Die Publikation existiert in Supabase-Projekten standardmaessig; der Block
-- macht die Migration auch gegen eine blanke Postgres-Instanz lauffaehig.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'points'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE points;
    END IF;
  END IF;
END
$$;
