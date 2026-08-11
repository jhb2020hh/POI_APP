import "../loadEnv.js";
import { randomInt } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createUser,
  ensureProfile,
  getUserByEmail,
} from "../repositories/userRepository.js";
import { pool } from "../db/connection.js";
import { supabaseAdmin } from "../supabase.js";
import { ROLES } from "../authorization.js";

/**
 * Legt das erste Konto an oder bindet ein bereits in Supabase angelegtes an.
 *
 * Verwendung:
 *   npm run seed:admin -- <email> [anzeigename] [rolle] [--password=<passwort>]
 *
 * Ohne --password wird eines erzeugt und ausschliesslich in
 * ADMIN-ZUGANGSDATEN.txt geschrieben - nicht auf die Konsole, weil
 * Terminalausgaben in Protokollen und Verlaeufen landen.
 *
 * Das Passwort ist bewusst kein Positionsargument mehr: unter Windows
 * verschluckt die Kommandozeile ein leeres Argument, wodurch sich alle
 * folgenden Werte verschieben.
 */
const args = process.argv.slice(2);
const passwordFlag = args.find((a) => a.startsWith("--password="));
const positional = args.filter((a) => !a.startsWith("--"));

const email = positional[0];
const displayName = positional[1] ?? email;
const role = positional[2] ?? "admin";
const passwordArg = passwordFlag?.slice("--password=".length);

// Ohne mehrdeutige Zeichen (0/O, 1/l/I), damit das Passwort auch abgeschrieben
// oder durchtelefoniert werden kann.
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function generatePassword(): string {
  const groups = Array.from({ length: 4 }, () =>
    Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")
  );
  // Grossbuchstaben und Sonderzeichen, damit auch strengere Passwortregeln
  // erfuellt sind, falls sie im Supabase-Projekt eingeschaltet werden.
  return `${groups[0]}-${groups[1]}-${groups[2]}-${groups[3].toUpperCase()}!`;
}

const credentialsFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "ADMIN-ZUGANGSDATEN.txt"
);

function writeCredentialsFile(input: {
  email: string;
  password: string;
  displayName: string;
  role: string;
}): void {
  writeFileSync(
    credentialsFile,
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
      "Es gibt derzeit weder eine Funktion zum Aendern des eigenen Passworts",
      'noch einen Versand fuer "Passwort vergessen" - beides braeuchte einen',
      "eingerichteten SMTP-Server im Supabase-Projekt.",
      "",
      "Weitere Nutzer im Admin-Menue der laufenden Anwendung anlegen",
      "(Rollen: extern / mitarbeiter / admin).",
      "",
    ].join("\n"),
    "utf-8"
  );
}

/** Die Admin-API kennt keine Suche nach E-Mail, deshalb seitenweise durchgehen. */
async function findAuthUserByEmail(
  wanted: string
): Promise<{ id: string; email: string } | undefined> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Konten konnten nicht gelesen werden: ${error.message}`);
    const match = data.users.find(
      (u) => u.email?.toLowerCase() === wanted.toLowerCase()
    );
    if (match?.email) return { id: match.id, email: match.email };
    if (data.users.length < 200) return undefined;
  }
  return undefined;
}

async function main(): Promise<void> {
  if (!email) {
    console.error(
      "Verwendung: npm run seed:admin -- <email> [anzeigename] [rolle] [--password=<passwort>]\n" +
        "Ohne --password wird eines erzeugt und in ADMIN-ZUGANGSDATEN.txt geschrieben.\n" +
        `Rollen: ${ROLES.join(", ")}`
    );
    process.exitCode = 1;
    return;
  }

  if (!ROLES.includes(role as (typeof ROLES)[number])) {
    console.error(`Ungültige Rolle "${role}". Erlaubt: ${ROLES.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  if (await getUserByEmail(email)) {
    console.error(`Nutzer mit E-Mail ${email} hat bereits ein Profil.`);
    process.exitCode = 1;
    return;
  }

  const existingAuthUser = await findAuthUserByEmail(email);

  if (existingAuthUser) {
    // Konto wurde in der Supabase-Oberflaeche angelegt und hat noch kein
    // Profil - ohne das bekaeme es beim ersten Anmelden die Standardrolle
    // "extern" und damit kaum Rechte.
    const user = await ensureProfile({
      id: existingAuthUser.id,
      email: existingAuthUser.email,
      displayName,
      role,
    });

    // Die Rolle zusaetzlich ins Token spiegeln (wird fuer die Realtime-Regeln
    // gebraucht). Fuehrende Quelle bleibt die Tabelle.
    await supabaseAdmin.auth.admin.updateUserById(existingAuthUser.id, {
      app_metadata: { role },
      ...(passwordArg ? { password: passwordArg } : {}),
    });

    console.log(
      `Bestehendes Supabase-Konto angebunden: ${user.email} (${user.id}), Rolle: ${user.role}`
    );
    if (passwordArg) {
      console.log("Passwort wurde neu gesetzt.");
    } else {
      console.log(
        "Das bestehende Passwort bleibt unveraendert. Zum Neusetzen: --password=<passwort>"
      );
    }
    return;
  }

  const generated = !passwordArg;
  const password = passwordArg ?? generatePassword();

  const user = await createUser({ email, password, displayName, role });
  console.log(`Nutzer angelegt: ${user.email} (${user.id}), Rolle: ${user.role}`);

  if (generated) {
    writeCredentialsFile({ email, password, displayName, role });
    console.log(`Passwort erzeugt und geschrieben nach: ${credentialsFile}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
