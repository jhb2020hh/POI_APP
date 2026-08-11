import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Laedt eine .env aus dem Projektstamm, sofern vorhanden.
 *
 * Node liest .env-Dateien nicht von selbst ein. Auf Vercel kommen die Werte aus
 * der Plattform, dort gibt es keine Datei und dieses Modul tut nichts. Lokal
 * erspart es, bei jedem Skriptaufruf die Variablen von Hand zu setzen.
 *
 * Wichtig: Dieses Modul muss in Skripten als *erster* Import stehen. Importe
 * werden vor dem uebrigen Code ausgefuehrt, und db/connection.ts liest die
 * Variablen bereits beim Laden.
 *
 * Bereits gesetzte Variablen werden nicht ueberschrieben - was in der Umgebung
 * steht, hat Vorrang vor der Datei.
 */
const startDir = path.dirname(fileURLToPath(import.meta.url));

// Der Aufruf erfolgt sowohl aus src/ (via tsx) als auch aus dist/ - deshalb
// wird der Projektstamm gesucht statt fest verdrahtet.
function findEnvFile(): string | undefined {
  let dir = startDir;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const envFile = findEnvFile();
if (envFile) {
  try {
    process.loadEnvFile(envFile);
    console.log(`Umgebungsvariablen geladen aus ${envFile}`);
  } catch (error) {
    console.warn(`.env konnte nicht gelesen werden (${envFile}):`, error);
  }
}
