import "../loadEnv.js";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin, SUPABASE_URL } from "../supabase.js";
import { ensureProfile } from "../repositories/userRepository.js";
import { pool } from "../db/connection.js";

/**
 * Spielt die Selbstregistrierung durch und raeumt hinterher auf.
 *
 *   npm run diagnose:registrierung
 *
 * Geprueft wird die Kette, auf die es ankommt: Ein neues Konto darf sich nicht
 * anmelden koennen, bevor ein Admin es freischaltet - und danach schon.
 *
 * Voraussetzung: das Backend laeuft (npm run dev:backend).
 */
const target = process.env.DIAGNOSE_TARGET ?? "http://localhost:3001";
const anonKey =
  process.env.SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY;

const PASSWORT = "diagnose-nur-temporaer-9F!";

function melde(ok: boolean, name: string, detail: string): boolean {
  console.log(`${ok ? "  OK  " : " FEHL "} ${name.padEnd(46)} ${detail}`);
  return ok;
}

async function anmeldenUndProfilAbrufen(
  email: string
): Promise<{ status: number; body: string }> {
  const anonClient = createClient(SUPABASE_URL, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anonClient.auth.signInWithPassword({
    email,
    password: PASSWORT,
  });
  if (error || !data.session) {
    return { status: 0, body: error?.message ?? "keine Sitzung" };
  }
  const response = await fetch(`${target}/api/me`, {
    headers: { Authorization: `Bearer ${data.session.access_token}` },
  });
  return { status: response.status, body: await response.text() };
}

async function main(): Promise<void> {
  if (!anonKey) {
    console.error("Kein anon-Key in der Umgebung (SUPABASE_ANON_KEY).");
    process.exitCode = 1;
    return;
  }

  const zeit = Date.now();
  const neuEmail = `diagnose-neu-${zeit}@example.com`;
  const adminEmail = `diagnose-admin-${zeit}@example.com`;
  let alleOk = true;

  // Der Neuling entsteht wie bei einer Selbstregistrierung: Konto bei Supabase,
  // aber kein Profil - das legt das Backend beim ersten Anmelden an.
  const { data: neu } = await supabaseAdmin.auth.admin.createUser({
    email: neuEmail,
    password: PASSWORT,
    email_confirm: true,
  });
  // Ein freigeschalteter Admin, der die Entscheidung trifft.
  const { data: admin } = await supabaseAdmin.auth.admin.createUser({
    email: adminEmail,
    password: PASSWORT,
    email_confirm: true,
  });
  await ensureProfile({
    id: admin!.user!.id,
    email: adminEmail,
    displayName: "Diagnose-Admin",
    role: "admin",
    approved: true,
  });

  const neuId = neu!.user!.id;

  try {
    // 1. Erster Anmeldeversuch - muss abgelehnt werden
    const ersterVersuch = await anmeldenUndProfilAbrufen(neuEmail);
    const abgelehnt =
      ersterVersuch.status === 403 && ersterVersuch.body.includes("NICHT_FREIGESCHALTET");
    alleOk =
      melde(
        abgelehnt,
        "1. Anmeldung vor Freischaltung abgewiesen",
        `HTTP ${ersterVersuch.status}`
      ) && alleOk;

    // 2. Profil steht auf gesperrt, niedrigste Rolle
    const profil = await pool.query<{ role: string; approved: number }>(
      "SELECT role, approved FROM users WHERE id = $1",
      [neuId]
    );
    const richtigAngelegt =
      profil.rows[0]?.role === "extern" && profil.rows[0]?.approved === 0;
    alleOk =
      melde(
        richtigAngelegt,
        "2. Profil angelegt: Rolle extern, gesperrt",
        profil.rows[0]
          ? `role=${profil.rows[0].role} approved=${profil.rows[0].approved}`
          : "kein Profil"
      ) && alleOk;

    // 3. Admin sieht den Antrag und schaltet frei
    const anonClient = createClient(SUPABASE_URL, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: adminSitzung } = await anonClient.auth.signInWithPassword({
      email: adminEmail,
      password: PASSWORT,
    });
    const adminKopf = {
      Authorization: `Bearer ${adminSitzung!.session!.access_token}`,
    };

    const antraege = await fetch(`${target}/api/users/pending`, { headers: adminKopf });
    const antragsListe = (await antraege.json()) as { id: string }[];
    alleOk =
      melde(
        antraege.ok && antragsListe.some((u) => u.id === neuId),
        "3. Antrag erscheint in der Warteschlange",
        `HTTP ${antraege.status}, ${antragsListe.length ?? 0} offen`
      ) && alleOk;

    const freischalten = await fetch(`${target}/api/users/${neuId}/approve`, {
      method: "POST",
      headers: adminKopf,
    });
    alleOk =
      melde(freischalten.status === 204, "4. Freischalten durch Admin", `HTTP ${freischalten.status}`) &&
      alleOk;

    // 5. Jetzt muss die Anmeldung durchgehen
    const zweiterVersuch = await anmeldenUndProfilAbrufen(neuEmail);
    alleOk =
      melde(
        zweiterVersuch.status === 200,
        "5. Anmeldung nach Freischaltung moeglich",
        `HTTP ${zweiterVersuch.status}`
      ) && alleOk;

    // 6. Ein Nicht-Admin darf die Warteschlange nicht sehen
    const fremd = await anmeldenUndProfilAbrufen(neuEmail);
    if (fremd.status === 200) {
      const { data: externSitzung } = await anonClient.auth.signInWithPassword({
        email: neuEmail,
        password: PASSWORT,
      });
      const verboten = await fetch(`${target}/api/users/pending`, {
        headers: { Authorization: `Bearer ${externSitzung!.session!.access_token}` },
      });
      alleOk =
        melde(
          verboten.status === 403,
          "6. Warteschlange fuer Nicht-Admin gesperrt",
          `HTTP ${verboten.status}`
        ) && alleOk;
    }
  } finally {
    for (const id of [neuId, admin!.user!.id]) {
      await pool.query("DELETE FROM users WHERE id = $1", [id]);
      await supabaseAdmin.auth.admin.deleteUser(id);
    }
    console.log("\nAufgeraeumt: beide Testkonten entfernt.");
    if (!alleOk) process.exitCode = 1;
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
