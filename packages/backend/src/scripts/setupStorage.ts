import "../loadEnv.js";
import { ATTACHMENTS_BUCKET, PLANS_BUCKET, supabaseAdmin } from "../supabase.js";

/**
 * Legt die Dateiablagen an und gleicht bestehende an die aktuelle Vorgabe an.
 *
 * Beide Ablagen sind privat: Zugriff gibt es nur ueber kurzlebige signierte
 * URLs, die die API nach der Rechtepruefung ausstellt (siehe routes/plans.ts
 * und routes/attachments.ts).
 *
 * Bewusst *keine* Einschraenkung der Inhaltstypen: storage-js verpackt einen
 * Blob - und eine File aus dem Dateidialog ist einer - in FormData und setzt
 * dabei keinen content-type-Header. Der Typ, gegen den Supabase pruefen wuerde,
 * stammt damit aus der Datei selbst und ist vom Anwendungscode nicht
 * zuverlaessig bestimmbar; meldet das Betriebssystem einen abweichenden oder
 * leeren Typ, waere der Upload abgelehnt worden. Die inhaltliche Pruefung
 * bleibt serverseitig in routes/attachments.ts, und ausgeliefert werden die
 * Dateien ausschliesslich ueber signierte URLs.
 */
const BUCKETS = [PLANS_BUCKET, ATTACHMENTS_BUCKET];

const VORGABE = {
  public: false,
  allowedMimeTypes: null,
} as const;

async function main(): Promise<void> {
  const { data: existing, error } = await supabaseAdmin.storage.listBuckets();
  if (error) {
    throw new Error(`Ablagen konnten nicht gelesen werden: ${error.message}`);
  }
  const existingNames = new Set(existing.map((bucket) => bucket.name));

  for (const name of BUCKETS) {
    if (existingNames.has(name)) {
      const { error: updateError } = await supabaseAdmin.storage.updateBucket(name, {
        public: VORGABE.public,
        allowedMimeTypes: VORGABE.allowedMimeTypes,
      });
      if (updateError) {
        throw new Error(`Ablage ${name} konnte nicht angeglichen werden: ${updateError.message}`);
      }
      console.log(`Angeglichen: ${name} (privat, keine Typbeschränkung)`);
      continue;
    }

    const { error: createError } = await supabaseAdmin.storage.createBucket(name, {
      public: VORGABE.public,
    });
    if (createError) {
      throw new Error(`Ablage ${name} konnte nicht angelegt werden: ${createError.message}`);
    }
    console.log(`Angelegt: ${name} (privat)`);
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
