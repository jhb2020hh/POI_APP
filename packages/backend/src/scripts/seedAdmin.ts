import { runMigrations } from "../db/migrate.js";
import { createUser, getUserByEmail } from "../repositories/userRepository.js";
import { ROLES } from "../authorization.js";

runMigrations();

const email = process.argv[2];
const password = process.argv[3];
const displayName = process.argv[4] ?? email;
const role = process.argv[5] ?? "admin";

if (!email || !password) {
  console.error(
    `Verwendung: npm run seed:admin -w packages/backend -- <email> <passwort> [anzeigename] [rolle]\nRollen: ${ROLES.join(", ")}`
  );
  process.exit(1);
}

if (!ROLES.includes(role as (typeof ROLES)[number])) {
  console.error(`Ungültige Rolle "${role}". Erlaubt: ${ROLES.join(", ")}`);
  process.exit(1);
}

const existing = getUserByEmail(email);
if (existing) {
  console.error(`Nutzer mit E-Mail ${email} existiert bereits.`);
  process.exit(1);
}

const user = await createUser({ email, password, displayName, role });
console.log(`Nutzer angelegt: ${user.email} (${user.id}), Rolle: ${user.role}`);
