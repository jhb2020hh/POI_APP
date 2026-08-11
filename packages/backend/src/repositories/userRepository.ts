import { db } from "../db/connection.js";
import { supabaseAdmin } from "../supabase.js";

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: string;
  created_at: string;
}

/**
 * Legt den Nutzer in Supabase Auth an und spiegelt ihn als Profilzeile.
 *
 * Die beiden Systeme lassen sich nicht in einer gemeinsamen Transaktion
 * schreiben. Schlaegt das Profil fehl, wird der Auth-Nutzer deshalb wieder
 * entfernt - sonst bliebe ein Konto zurueck, mit dem man sich anmelden kann,
 * das aber keine Rolle und keinen Namen haette.
 */
export async function createUser(input: {
  email: string;
  password: string;
  displayName: string;
  role?: string;
}): Promise<User> {
  const role = input.role ?? "extern";

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    // Die Rolle liegt zusaetzlich im Token, damit die Realtime-Regeln sie ohne
    // Datenbankabfrage auswerten koennen. Fuehrende Quelle bleibt die Tabelle.
    app_metadata: { role },
    user_metadata: { display_name: input.displayName },
  });

  if (error || !data.user) {
    throw new Error(`Supabase-Nutzer konnte nicht angelegt werden: ${error?.message}`);
  }

  try {
    await db
      .prepare(
        "INSERT INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)"
      )
      .run(data.user.id, input.email, input.displayName, role);
  } catch (dbError) {
    await supabaseAdmin.auth.admin.deleteUser(data.user.id);
    throw dbError;
  }

  return (await getUserById(data.user.id))!;
}

export async function getUserById(id: string): Promise<User | undefined> {
  return db.prepare("SELECT * FROM users WHERE id = ?").get<User>(id);
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  return db.prepare("SELECT * FROM users WHERE email = ?").get<User>(email);
}

export interface UserSummary {
  id: string;
  email: string;
  display_name: string;
  role: string;
}

export async function listUsers(): Promise<UserSummary[]> {
  return db
    .prepare("SELECT id, email, display_name, role FROM users ORDER BY display_name")
    .all<UserSummary>();
}

/**
 * Legt die Profilzeile fuer einen bereits existierenden Auth-Nutzer an.
 * Greift beim ersten Login von Konten, die direkt in der Supabase-Oberflaeche
 * angelegt wurden - ohne das haetten sie kein Profil und damit keine Rolle.
 */
export async function ensureProfile(input: {
  id: string;
  email: string;
  displayName?: string;
  role?: string;
}): Promise<User> {
  const existing = await getUserById(input.id);
  if (existing) return existing;

  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`
    )
    .run(
      input.id,
      input.email,
      input.displayName ?? input.email,
      input.role ?? "extern"
    );

  return (await getUserById(input.id))!;
}
