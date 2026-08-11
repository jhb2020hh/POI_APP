import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Wie in db/connection.ts bewusst kein Abbruch beim Laden des Moduls: in einer
 * Serverless-Umgebung wuerde das die gesamte Function lahmlegen und jeder
 * Endpunkt antwortete mit einer nichtssagenden 500 - auch der, mit dem sich die
 * Ursache feststellen liesse.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && serviceRoleKey);

export const SUPABASE_URL = supabaseUrl ?? "";

function requireConfig(): { url: string; key: string } {
  if (!supabaseUrl || !serviceRoleKey) {
    const fehlend = [
      supabaseUrl ? null : "SUPABASE_URL",
      serviceRoleKey ? null : "SUPABASE_SERVICE_ROLE_KEY",
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(`Nicht gesetzt: ${fehlend}`);
  }
  return { url: supabaseUrl, key: serviceRoleKey };
}

const globalForSupabase = globalThis as typeof globalThis & {
  __poiSupabaseAdmin?: SupabaseClient;
};

function createAdminClient(): SupabaseClient {
  const { url, key } = requireConfig();
  // `persistSession: false`, weil auf dem Server keine Sitzung mitgefuehrt wird:
  // jede Function-Instanz ist zustandslos.
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!globalForSupabase.__poiSupabaseAdmin) {
    globalForSupabase.__poiSupabaseAdmin = createAdminClient();
  }
  return globalForSupabase.__poiSupabaseAdmin;
}

/**
 * Client mit Service-Role-Rechten. Umgeht Row Level Security und darf Nutzer
 * anlegen - deshalb ausschliesslich serverseitig verwenden, der Schluessel darf
 * niemals ins Frontend-Bundle gelangen.
 *
 * Weiterleitung auf den erst bei Bedarf erzeugten Client, damit die vorhandenen
 * Aufrufstellen unveraendert bleiben.
 */
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const instance = getSupabaseAdmin() as unknown as Record<string | symbol, unknown>;
    const value = instance[property];
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export const PLANS_BUCKET = "plans";
export const ATTACHMENTS_BUCKET = "attachments";
