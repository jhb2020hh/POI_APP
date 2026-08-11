import { randomInt } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabaseAdmin } from "./supabase.js";

// Gemeinsame Bausteine der Konten-Skripte (seedAdmin, setPassword).

// Ohne mehrdeutige Zeichen (0/O, 1/l/I), damit das Passwort auch abgeschrieben
// oder durchtelefoniert werden kann.
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function generatePassword(): string {
  const groups = Array.from({ length: 4 }, () =>
    Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")
  );
  // Grossbuchstaben und Sonderzeichen, damit auch strengere Passwortregeln
  // erfuellt sind, falls sie im Supabase-Projekt eingeschaltet werden.
  return `${groups[0]}-${groups[1]}-${groups[2]}-${groups[3].toUpperCase()}!`;
}

export const CREDENTIALS_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "ADMIN-ZUGANGSDATEN.txt"
);

/**
 * Schreibt die Zugangsdaten in eine lokale Datei - bewusst nicht auf die
 * Konsole: Terminalausgaben landen in Protokollen und im Verlauf. Die Datei ist
 * ueber .gitignore vom Repository ausgeschlossen.
 */
export function writeCredentialsFile(input: {
  email: string;
  password: string;
  displayName: string;
  role: string;
}): void {
  writeFileSync(
    CREDENTIALS_FILE,
    [
      "POI-APP - Zugangsdaten",
      "======================",
      "",
      "WICHTIG: Diese Datei enthaelt ein Passwort im Klartext. Sie ist ueber",
      ".gitignore vom Repository ausgeschlossen - nicht weitergeben und nicht",
      "in andere Systeme kopieren.",
      "",
      "Supabase-Projekt (Cloud-Betrieb):",
      `    E-Mail:    ${input.email}`,
      `    Passwort:  ${input.password}`,
      `    Name:      ${input.displayName}`,
      `    Rolle:     ${input.role}`,
      "",
      "Das Konto liegt in Supabase Auth, die Rolle in der Tabelle users.",
      "Passwort neu setzen:",
      "    npm run set:password -- <email> [--password=<passwort>]",
      "",
      "Weitere Nutzer im Admin-Menue der laufenden Anwendung anlegen",
      "(Rollen: extern / mitarbeiter / admin).",
      "",
    ].join("\n"),
    "utf-8"
  );
}

export interface AuthUser {
  id: string;
  email: string;
}

/** Die Admin-API kennt keine Suche nach E-Mail, deshalb seitenweise durchgehen. */
export async function findAuthUserByEmail(
  wanted: string
): Promise<AuthUser | undefined> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new Error(`Konten konnten nicht gelesen werden: ${error.message}`);
    const match = data.users.find(
      (u) => u.email?.toLowerCase() === wanted.toLowerCase()
    );
    if (match?.email) return { id: match.id, email: match.email };
    if (data.users.length < 200) return undefined;
  }
  return undefined;
}

/**
 * Zerlegt die Argumente der Konten-Skripte.
 *
 * Das Passwort ist bewusst kein Positionsargument: unter Windows verschluckt
 * die Kommandozeile ein leeres Argument, wodurch sich alle folgenden Werte
 * stillschweigend um eine Stelle verschieben.
 */
export function parseArgs(argv: string[]): {
  positional: string[];
  password?: string;
} {
  const flag = argv.find((a) => a.startsWith("--password="));
  return {
    positional: argv.filter((a) => !a.startsWith("--")),
    password: flag?.slice("--password=".length),
  };
}
