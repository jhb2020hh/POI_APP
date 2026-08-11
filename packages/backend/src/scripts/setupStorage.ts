import "../loadEnv.js";
import { ATTACHMENTS_BUCKET, PLANS_BUCKET, supabaseAdmin } from "../supabase.js";

// Beide Ablagen sind privat: Zugriff gibt es nur ueber kurzlebige signierte
// URLs, die die API nach der Rechtepruefung ausstellt (siehe routes/plans.ts
// und routes/attachments.ts).
const BUCKETS = [
  { name: PLANS_BUCKET, allowedMimeTypes: ["application/pdf"] },
  { name: ATTACHMENTS_BUCKET, allowedMimeTypes: null },
];

async function main(): Promise<void> {
  const { data: existing, error } = await supabaseAdmin.storage.listBuckets();
  if (error) {
    throw new Error(`Ablagen konnten nicht gelesen werden: ${error.message}`);
  }
  const existingNames = new Set(existing.map((bucket) => bucket.name));

  for (const bucket of BUCKETS) {
    if (existingNames.has(bucket.name)) {
      console.log(`Übersprungen (existiert bereits): ${bucket.name}`);
      continue;
    }
    const { error: createError } = await supabaseAdmin.storage.createBucket(bucket.name, {
      public: false,
      allowedMimeTypes: bucket.allowedMimeTypes ?? undefined,
    });
    if (createError) {
      throw new Error(`Ablage ${bucket.name} konnte nicht angelegt werden: ${createError.message}`);
    }
    console.log(`Angelegt: ${bucket.name} (privat)`);
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
