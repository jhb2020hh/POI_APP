import "../loadEnv.js";
import { pool } from "../db/connection.js";

// Diagnosehilfe: zeigt an, was in der Datenbank tatsaechlich angelegt wurde.
// Nuetzlich nach dem Migrationslauf und wenn unklar ist, ob die Zugriffsregeln
// greifen.
async function show(label: string, sql: string): Promise<void> {
  const result = await pool.query(sql);
  console.log(`\n--- ${label} (${result.rows.length}) ---`);
  for (const row of result.rows) {
    console.log("  " + Object.values(row).map(String).join("  |  "));
  }
}

try {
  await show(
    "Tabellen und Row Level Security",
    `SELECT tablename, CASE WHEN rowsecurity THEN 'RLS an' ELSE 'RLS AUS !!' END AS rls
     FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  await show(
    "Policies",
    `SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public'`
  );
  await show(
    "Realtime-Publikation",
    `SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'`
  );
  await show(
    "Eigene Funktionen",
    `SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND proname LIKE 'poi\\_%'`
  );
  await show("Vorbelegte Kategorien", "SELECT id, name FROM categories ORDER BY id");
  await show("Zeitstempel-Format", "SELECT poi_now_iso() AS jetzt");
  await show("Angewandte Migrationen", "SELECT COUNT(*) AS anzahl FROM _migrations");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
