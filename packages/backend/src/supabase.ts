import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error("SUPABASE_URL ist nicht gesetzt.");
}
if (!serviceRoleKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY ist nicht gesetzt.");
}

export const SUPABASE_URL = supabaseUrl;

/**
 * Client mit Service-Role-Rechten. Umgeht Row Level Security und darf Nutzer
 * anlegen - deshalb ausschliesslich serverseitig verwenden, der Schluessel darf
 * niemals ins Frontend-Bundle gelangen.
 *
 * `persistSession: false`, weil auf dem Server keine Sitzung mitgefuehrt wird:
 * jede Function-Instanz ist zustandslos.
 */
export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const PLANS_BUCKET = "plans";
export const ATTACHMENTS_BUCKET = "attachments";
