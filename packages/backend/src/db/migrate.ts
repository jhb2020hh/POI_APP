import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "./connection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "migrations");

// Beliebige, aber feste Zahl: verhindert, dass zwei parallel gestartete
// Migrationslaeufe dieselbe Datei gleichzeitig einspielen.
const MIGRATION_LOCK_ID = 8_147_233;

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      )
    `);

    const appliedRows = await client.query<{ name: string }>(
      "SELECT name FROM _migrations"
    );
    const applied = new Set(appliedRows.rows.map((row) => row.name));

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(path.join(migrationsDir, file), "utf-8");

      // Jede Migration laeuft als Ganzes oder gar nicht - anders als bisher bleibt
      // bei einem Fehler mittendrin kein halb angewandtes Schema zurueck.
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} fehlgeschlagen: ${String(error)}`);
      }
      console.log(`Applied migration: ${file}`);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    client.release();
  }
}
