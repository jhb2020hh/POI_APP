import "../loadEnv.js";
import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/connection.js";

// Migrationen laufen bewusst als eigener Befehl und nicht beim Serverstart:
// auf Vercel wuerde sonst jeder Kaltstart einer Function das Schema anfassen.
try {
  await runMigrations();
  console.log("Migrationen abgeschlossen.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
