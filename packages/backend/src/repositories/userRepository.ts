import { db } from "../db/connection.js";
import { supabaseAdmin } from "../supabase.js";

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: string;
  created_at: string;
  /** 0 = wartet auf Freischaltung durch einen Admin, 1 = freigeschaltet. */
  approved: number;
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
    // Von einem Admin angelegt - also bereits freigeschaltet. Nur die
    // Selbstregistrierung landet in der Warteschlange (siehe ensureProfile).
    await db
      .prepare(
        "INSERT INTO users (id, email, display_name, role, approved) VALUES (?, ?, ?, ?, 1)"
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
 *
 * Greift bei Konten, die nicht ueber createUser entstanden sind: per
 * Selbstregistrierung oder direkt in der Supabase-Oberflaeche angelegt. Ohne
 * Profil haetten sie keine Rolle.
 *
 * Solche Konten bekommen die niedrigste Rolle und bleiben gesperrt, bis ein
 * Admin sie freischaltet. Der Standard ist bewusst die restriktive Annahme -
 * ein Konto, das durch eine Luecke hier landet, kann so nichts anrichten.
 */
export async function ensureProfile(input: {
  id: string;
  email: string;
  displayName?: string;
  role?: string;
  approved?: boolean;
}): Promise<User> {
  const existing = await getUserById(input.id);
  if (existing) return existing;

  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, role, approved) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`
    )
    .run(
      input.id,
      input.email,
      input.displayName ?? input.email,
      input.role ?? "extern",
      input.approved ? 1 : 0
    );

  return (await getUserById(input.id))!;
}

/** Konten, die auf Freischaltung warten - aelteste zuerst. */
export async function listPendingUsers(): Promise<UserSummary[]> {
  return db
    .prepare(
      `SELECT id, email, display_name, role FROM users
       WHERE approved = 0 ORDER BY created_at ASC`
    )
    .all<UserSummary>();
}

export async function setUserApproved(
  id: string,
  approved: boolean
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE users SET approved = ? WHERE id = ?")
    .run(approved ? 1 : 0, id);
  return result.changes > 0;
}

/**
 * Entfernt ein Konto vollstaendig - Profil und Anmeldedaten.
 *
 * Reihenfolge bewusst: erst das Profil, dann der Auth-Nutzer. Bricht es
 * dazwischen ab, bleibt ein Konto ohne Profil zurueck, das beim naechsten
 * Anmelden wieder in der Warteschlange landet. Andersherum bliebe ein Profil
 * ohne Anmeldemoeglichkeit stehen, das niemand mehr aufraeumt.
 */
export async function deleteUser(id: string): Promise<void> {
  await db.prepare("DELETE FROM users WHERE id = ?").run(id);
  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) {
    throw new Error(`Konto konnte nicht entfernt werden: ${error.message}`);
  }
}
