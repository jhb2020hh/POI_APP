-- ===========================================================================
-- Exportvorlagen
-- ===========================================================================
-- Bis hierher war der Umfang einer Ausgabe fest verdrahtet: die CSV-Datei
-- hatte zwoelf Spalten, die Ticketseiten im Plan-PDF acht Felder, beides ohne
-- Einstellmoeglichkeit.
--
-- Eine Vorlage ist eine benannte, geordnete Liste von Spalten. Sie gilt fuer
-- beide Ausgaben: in der CSV-Datei sind es die Spalten, auf einer Ticketseite
-- die Felder. Derselbe Schluesselsatz, deshalb dieselbe Vorlage.
--
-- project_id NULL bedeutet "fuer alle Projekte" - dieselbe Regel wie bei
-- categories, damit sich beides gleich verhaelt.

CREATE TABLE export_templates (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  name TEXT NOT NULL,
  -- JSON-Array von Spaltenschluesseln in Ausgabereihenfolge. Bewusst als Text
  -- und nicht als eigene Tabelle: die Reihenfolge ist Teil der Angabe, und
  -- eine Zeile je Spalte haette eine Sortierspalte gebraucht, die beim
  -- Umsortieren staendig neu geschrieben wird.
  columns_json TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT poi_now_iso(),
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_export_templates_project ON export_templates(project_id);

-- Wie in 0020: Supabase veroeffentlicht jede Tabelle des public-Schemas ueber
-- PostgREST. Ohne RLS waere die Tabelle mit dem oeffentlichen anon-Key an der
-- Anwendung vorbei les- und schreibbar. Keine Policy = kein Zugriff; die
-- Anwendung arbeitet mit dem service_role-Schluessel und ist nicht betroffen.
ALTER TABLE export_templates ENABLE ROW LEVEL SECURITY;
