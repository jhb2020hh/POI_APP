import "../loadEnv.js";
import { createClient } from "@supabase/supabase-js";
import { decodeProtectedHeader } from "jose";
import { supabaseAdmin, SUPABASE_URL } from "../supabase.js";
import { pool } from "../db/connection.js";

/**
 * Diagnose des Anmeldewegs: legt ein Wegwerf-Konto an, meldet sich damit an und
 * zeigt, womit das Zugriffstoken signiert ist. Damit laesst sich klaeren, ob das
 * Backend SUPABASE_JWT_SECRET braucht (klassisches HS256) oder die
 * oeffentlichen Schluessel abruft (asymmetrisch).
 */
const anonKey =
  process.env.SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY;

const testEmail = `diagnose-${Date.now()}@example.com`;
const testPassword = "diagnose-nur-temporaer-9F!";

async function main(): Promise<void> {
  if (!anonKey) {
    console.error("Kein anon-Key in der Umgebung (SUPABASE_ANON_KEY).");
    process.exitCode = 1;
    return;
  }

  console.log("JWT_SECRET gesetzt:", Boolean(process.env.SUPABASE_JWT_SECRET));

  const jwksUrl = `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  try {
    const response = await fetch(jwksUrl);
    const body = await response.text();
    console.log(`JWKS-Endpunkt: HTTP ${response.status}, ${body.slice(0, 120)}`);
  } catch (error) {
    console.log("JWKS-Endpunkt nicht erreichbar:", String(error));
  }

  const { data: created, error: createError } =
    await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    });
  if (createError || !created.user) {
    console.error("Testkonto konnte nicht angelegt werden:", createError?.message);
    process.exitCode = 1;
    return;
  }

  try {
    const anonClient = createClient(SUPABASE_URL, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anonClient.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    });

    if (error || !data.session) {
      console.error("Anmeldung fehlgeschlagen:", error?.message);
      process.exitCode = 1;
      return;
    }

    const token = data.session.access_token;
    const header = decodeProtectedHeader(token);
    console.log("Token-Signaturverfahren:", JSON.stringify(header));

    // Denselben Weg gehen wie das Frontend nach dem Anmelden: /api/me abrufen.
    // Hier zeigt sich, ob das Backend das Token akzeptiert und ein Profil
    // anlegen kann.
    const target = process.env.DIAGNOSE_TARGET ?? "http://localhost:3001";
    const response = await fetch(`${target}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.text();
    console.log(`GET ${target}/api/me -> HTTP ${response.status}`);
    console.log("Antwort: " + body.slice(0, 500));
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    await pool.query("DELETE FROM users WHERE id = $1", [created.user.id]);
    console.log("Testkonto wieder entfernt.");
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
