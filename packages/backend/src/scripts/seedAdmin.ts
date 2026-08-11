import "../loadEnv.js";
import {
  CREDENTIALS_FILE,
  findAuthUserByEmail,
  generatePassword,
  parseArgs,
  writeCredentialsFile,
} from "../adminAccount.js";
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
 *   npm run seed:admin -- <email> [anzeigename] [rolle] [--password=<passwort>]
 *
 * Migrationen laufen nicht implizit mit - vorher einmal `npm run db:migrate`.
 * Ohne --password wird eines erzeugt und ausschliesslich in
 * ADMIN-ZUGANGSDATEN.txt geschrieben.
 */
const { positional, password: passwordArg } = parseArgs(process.argv.slice(2));
const email = positional[0];
const displayName = positional[1] ?? email;
const role = positional[2] ?? "admin";

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
    console.error(
      `Nutzer mit E-Mail ${email} hat bereits ein Profil.\n` +
        "Passwort setzen: npm run set:password -- <email> [--password=<passwort>]"
    );
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
    console.log(
      passwordArg
        ? "Passwort wurde neu gesetzt."
        : "Das bestehende Passwort bleibt unveraendert. Neu setzen: npm run set:password"
    );
    return;
  }

  const generated = !passwordArg;
  const password = passwordArg ?? generatePassword();

  const user = await createUser({ email, password, displayName, role });
  console.log(`Nutzer angelegt: ${user.email} (${user.id}), Rolle: ${user.role}`);

  if (generated) {
    writeCredentialsFile({ email, password, displayName, role });
    console.log(`Passwort erzeugt und geschrieben nach: ${CREDENTIALS_FILE}`);
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
