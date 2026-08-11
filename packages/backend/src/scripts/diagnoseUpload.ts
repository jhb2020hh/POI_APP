import "../loadEnv.js";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin, SUPABASE_URL, PLANS_BUCKET } from "../supabase.js";
import { ensureProfile } from "../repositories/userRepository.js";
import { pool } from "../db/connection.js";

/**
 * Spielt den kompletten Plan-Upload durch und raeumt hinterher auf.
 *
 *   npm run diagnose:upload
 *
 * Der Upload laeuft im Browser nicht ueber die eigene API, sondern direkt zu
 * Supabase Storage. Genau dieser Schritt ist von aussen nicht einsehbar - hier
 * wird er nachgestellt: Node bringt Blob und FormData mit, deshalb nimmt
 * storage-js denselben Zweig wie im Browser (FormData statt Header), und eine
 * Ablehnung durch die Ablage zeigt sich hier genauso.
 *
 * Voraussetzung: das Backend laeuft (npm run dev:backend) oder
 * DIAGNOSE_TARGET zeigt auf eine erreichbare Instanz.
 */
const target = process.env.DIAGNOSE_TARGET ?? "http://localhost:3001";
const anonKey =
  process.env.SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY;

// Kleinstmoegliches gueltiges PDF.
const MINIMAL_PDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>
endobj
trailer
<< /Size 4 /Root 1 0 R >>
%%EOF
`;

interface Schritt {
  name: string;
  ok: boolean;
  detail: string;
}

const schritte: Schritt[] = [];

function melde(name: string, ok: boolean, detail: string): void {
  schritte.push({ name, ok, detail });
  console.log(`${ok ? "  OK  " : " FEHL "} ${name.padEnd(34)} ${detail}`);
}

async function main(): Promise<void> {
  if (!anonKey) {
    console.error("Kein anon-Key in der Umgebung (SUPABASE_ANON_KEY).");
    process.exitCode = 1;
    return;
  }

  const projekt = await pool.query<{ id: string; name: string }>(
    "SELECT id, name FROM projects WHERE archived = 0 ORDER BY created_at LIMIT 1"
  );
  if (projekt.rows.length === 0) {
    console.error("Kein Projekt vorhanden - bitte zuerst eines in der App anlegen.");
    process.exitCode = 1;
    return;
  }
  const projectId = projekt.rows[0].id;
  console.log(`Projekt: ${projekt.rows[0].name} (${projectId})`);
  console.log(`Ziel:    ${target}\n`);

  // Wegwerf-Konto mit Adminrolle: Admins duerfen laut authorization.ts auf jedes
  // Projekt zugreifen, damit entfaellt das Anlegen einer Mitgliedschaft.
  const testEmail = `diagnose-upload-${Date.now()}@example.com`;
  const testPassword = "diagnose-nur-temporaer-9F!";
  const { data: created, error: createError } =
    await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
      app_metadata: { role: "admin" },
    });
  if (createError || !created.user) {
    console.error("Testkonto konnte nicht angelegt werden:", createError?.message);
    process.exitCode = 1;
    return;
  }
  await ensureProfile({
    id: created.user.id,
    email: testEmail,
    displayName: "Upload-Diagnose",
    role: "admin",
  });

  let storagePath: string | undefined;
  let planId: string | undefined;

  try {
    const anonClient = createClient(SUPABASE_URL, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: session, error: signInError } =
      await anonClient.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });
    if (signInError || !session.session) {
      melde("Anmeldung", false, signInError?.message ?? "keine Sitzung");
      return;
    }
    const token = session.session.access_token;
    melde("Anmeldung", true, "Token erhalten");

    // Schritt 1: signierte Upload-URL anfordern
    const urlResponse = await fetch(`${target}/api/projects/${projectId}/plans/upload-url`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fileName: "diagnose.pdf" }),
    });
    const urlBody = await urlResponse.text();
    if (!urlResponse.ok) {
      melde("1. Upload-URL anfordern", false, `HTTP ${urlResponse.status}: ${urlBody.slice(0, 200)}`);
      return;
    }
    const signed = JSON.parse(urlBody) as { bucket: string; path: string; token: string };
    storagePath = signed.path;
    melde("1. Upload-URL anfordern", true, `Ablage=${signed.bucket} Pfad=${signed.path}`);

    // Schritt 2: Datei direkt zu Supabase Storage laden - der Schritt, der im
    // Browser passiert und dort bisher unsichtbar scheiterte.
    const blob = new Blob([MINIMAL_PDF], { type: "application/pdf" });
    const { error: uploadError } = await anonClient.storage
      .from(signed.bucket)
      .uploadToSignedUrl(signed.path, signed.token, blob, {
        contentType: "application/pdf",
      });
    if (uploadError) {
      melde("2. Direkt-Upload zur Ablage", false, uploadError.message);
      return;
    }
    melde("2. Direkt-Upload zur Ablage", true, `${MINIMAL_PDF.length} Bytes`);

    // Schritt 3: Plan registrieren
    const createResponse = await fetch(`${target}/api/projects/${projectId}/plans`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Diagnose-Plan", filePath: signed.path }),
    });
    const createBody = await createResponse.text();
    if (!createResponse.ok) {
      melde("3. Plan registrieren", false, `HTTP ${createResponse.status}: ${createBody.slice(0, 200)}`);
      return;
    }
    planId = (JSON.parse(createBody) as { id: string }).id;
    melde("3. Plan registrieren", true, `Plan-ID ${planId}`);

    // Schritt 4: Abruf ueber die API - muss auf eine signierte URL weiterleiten
    const fileResponse = await fetch(`${target}/api/plans/${planId}/file`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "manual",
    });
    const ziel = fileResponse.headers.get("location") ?? "";
    melde(
      "4. Abruf ueber die API",
      fileResponse.status === 302 && ziel.includes(PLANS_BUCKET),
      `HTTP ${fileResponse.status}${ziel ? " -> signierte URL" : ""}`
    );
  } finally {
    // Aufraeumen, damit die Diagnose keine Spuren hinterlaesst.
    if (planId) {
      await pool.query("DELETE FROM plans WHERE id = $1", [planId]);
    }
    if (storagePath) {
      await supabaseAdmin.storage.from(PLANS_BUCKET).remove([storagePath]);
    }
    await pool.query("DELETE FROM users WHERE id = $1", [created.user.id]);
    await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    console.log("\nAufgeraeumt: Testkonto, Plan und Datei entfernt.");

    const fehlgeschlagen = schritte.find((s) => !s.ok);
    if (fehlgeschlagen) {
      console.log(`\nAbgebrochen bei: ${fehlgeschlagen.name}`);
      console.log(`Ursache: ${fehlgeschlagen.detail}`);
      process.exitCode = 1;
    } else if (schritte.length > 0) {
      console.log("\nDer komplette Upload-Weg funktioniert.");
    }
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
