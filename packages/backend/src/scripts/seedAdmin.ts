import { createUser, getUserByEmail } from "../repositories/userRepository.js";
import { pool } from "../db/connection.js";
import { ROLES } from "../authorization.js";

// Migrationen laufen nicht mehr implizit mit - vorher einmal `npm run db:migrate`
// ausfuehren. Das Skript legt den Nutzer sowohl in Supabase Auth als auch in der
// Profiltabelle an (siehe createUser).
const email = process.argv[2];
const password = process.argv[3];
const displayName = process.argv[4] ?? email;
const role = process.argv[5] ?? "admin";

async function main(): Promise<void> {
  if (!email || !password) {
    console.error(
      `Verwendung: npm run seed:admin -w packages/backend -- <email> <passwort> [anzeigename] [rolle]\nRollen: ${ROLES.join(", ")}`
    );
    process.exitCode = 1;
    return;
  }

  if (!ROLES.includes(role as (typeof ROLES)[number])) {
    console.error(`Ungültige Rolle "${role}". Erlaubt: ${ROLES.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    console.error(`Nutzer mit E-Mail ${email} existiert bereits.`);
    process.exitCode = 1;
    return;
  }

  const user = await createUser({ email, password, displayName, role });
  console.log(`Nutzer angelegt: ${user.email} (${user.id}), Rolle: ${user.role}`);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
