import "../loadEnv.js";
import {
  CREDENTIALS_FILE,
  findAuthUserByEmail,
  generatePassword,
  parseArgs,
  writeCredentialsFile,
} from "../adminAccount.js";
import { getUserByEmail } from "../repositories/userRepository.js";
import { pool } from "../db/connection.js";
import { supabaseAdmin } from "../supabase.js";

/**
 * Setzt das Passwort eines bestehenden Kontos.
 *
 *   npm run set:password -- <email> [--password=<passwort>]
 *
 * Ohne --password wird eines erzeugt und nur in ADMIN-ZUGANGSDATEN.txt
 * geschrieben. Die Anwendung selbst hat keine Funktion zum Aendern des eigenen
 * Passworts und es ist kein E-Mail-Versand fuer "Passwort vergessen"
 * eingerichtet - dieses Skript ist deshalb der vorgesehene Weg.
 */
const { positional, password: passwordArg } = parseArgs(process.argv.slice(2));
const email = positional[0];

async function main(): Promise<void> {
  if (!email) {
    console.error(
      "Verwendung: npm run set:password -- <email> [--password=<passwort>]\n" +
        "Ohne --password wird eines erzeugt und in ADMIN-ZUGANGSDATEN.txt geschrieben."
    );
    process.exitCode = 1;
    return;
  }

  const authUser = await findAuthUserByEmail(email);
  if (!authUser) {
    console.error(`Kein Supabase-Konto mit E-Mail ${email} gefunden.`);
    process.exitCode = 1;
    return;
  }

  const generated = !passwordArg;
  const password = passwordArg ?? generatePassword();

  const { error } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
    password,
  });
  if (error) {
    throw new Error(`Passwort konnte nicht gesetzt werden: ${error.message}`);
  }

  console.log(`Passwort gesetzt für ${authUser.email}.`);

  if (generated) {
    const profile = await getUserByEmail(email);
    writeCredentialsFile({
      email: authUser.email,
      password,
      displayName: profile?.display_name ?? authUser.email,
      role: profile?.role ?? "unbekannt",
    });
    console.log(`Erzeugtes Passwort steht in: ${CREDENTIALS_FILE}`);
  }

  // Bestehende Sitzungen bleiben nach einer Passwortaenderung gueltig. Wer noch
  // einen Refresh-Token hat, koennte damit unbegrenzt weiterarbeiten - beim
  // Zuruecksetzen wegen eines moeglicherweise abgeflossenen Zugangs waere das
  // genau der Fall, den man verhindern will.
  //
  // Die Admin-Schnittstelle von supabase-js kann nur ueber ein vorliegendes
  // Token abmelden, nicht ueber die Nutzer-ID. Der direkte Weg ueber die
  // Sitzungstabelle erreicht dasselbe und beendet zuverlaessig alle Geraete.
  const result = await pool.query("DELETE FROM auth.sessions WHERE user_id = $1", [
    authUser.id,
  ]);
  console.log(`Bestehende Sitzungen beendet: ${result.rowCount ?? 0}`);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
