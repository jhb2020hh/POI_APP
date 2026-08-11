import "../loadEnv.js";
import { db, pool } from "../db/connection.js";
import { getUserByEmail } from "../repositories/userRepository.js";
import { findAuthUserByEmail } from "../adminAccount.js";
import { supabaseAdmin } from "../supabase.js";
import { ROLES } from "../authorization.js";

/**
 * Aendert die Rolle eines bestehenden Nutzers.
 *
 *   npm run set:role -- <email> <rolle>
 *
 * In der Oberflaeche laesst sich die Rolle nur beim Anlegen eines Nutzers
 * setzen, danach wird sie nur noch angezeigt. Wer ein Konto direkt im
 * Supabase-Dashboard anlegt, bekommt ausserdem beim ersten Anmelden
 * automatisch die Standardrolle "extern" - dieses Skript ist der Weg, das zu
 * korrigieren.
 */
const [email, role] = process.argv.slice(2);

async function main(): Promise<void> {
  if (!email || !role) {
    console.error(
      `Verwendung: npm run set:role -- <email> <rolle>\nRollen: ${ROLES.join(", ")}`
    );
    process.exitCode = 1;
    return;
  }

  if (!ROLES.includes(role as (typeof ROLES)[number])) {
    console.error(`Ungültige Rolle "${role}". Erlaubt: ${ROLES.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const profile = await getUserByEmail(email);
  if (!profile) {
    console.error(
      `Kein Profil für ${email}. Erst anbinden: npm run seed:admin -- <email> "<name>" <rolle>`
    );
    process.exitCode = 1;
    return;
  }

  if (profile.role === role) {
    console.log(`${email} hat bereits die Rolle ${role}.`);
    return;
  }

  await db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, profile.id);

  // Die Rolle zusaetzlich ins Token spiegeln - die Realtime-Regeln lesen sie
  // dort. Fuehrende Quelle bleibt die Tabelle: das Backend schlaegt sie bei
  // jeder Anfrage dort nach, damit ein Entzug sofort wirkt und nicht erst,
  // wenn ein bereits ausgestelltes Token ablaeuft.
  const authUser = await findAuthUserByEmail(email);
  if (authUser) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
      app_metadata: { role },
    });
    if (error) {
      console.warn(`Hinweis: app_metadata konnte nicht gesetzt werden (${error.message}).`);
    }
  }

  console.log(`${email}: ${profile.role} -> ${role}`);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
