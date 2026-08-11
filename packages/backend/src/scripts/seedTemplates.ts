import "../loadEnv.js";
import { db, pool } from "../db/connection.js";
import { createCategory } from "../repositories/categoryRepository.js";

const TEMPLATES: { name: string; color: string; glyph: string }[] = [
  { name: "Brandschutzdokumentation", color: "#e63946", glyph: "🔥" },
  { name: "Kernbohrungen", color: "#457b9d", glyph: "⊙" },
  { name: "Planprüfung", color: "#2a9d8f", glyph: "✓" },
  { name: "Zustandsfeststellung", color: "#e9c46a", glyph: "!" },
  { name: "Arbeitssicherheit", color: "#f4a261", glyph: "⚠" },
];

async function main(): Promise<void> {
  const existing = await db
    .prepare("SELECT name FROM categories WHERE project_id IS NULL")
    .all<{ name: string }>();
  const existingNames = new Set(existing.map((row) => row.name));

  for (const template of TEMPLATES) {
    if (existingNames.has(template.name)) {
      console.log(`Übersprungen (existiert bereits): ${template.name}`);
      continue;
    }
    await createCategory({
      projectId: null,
      name: template.name,
      color: template.color,
      glyph: template.glyph,
    });
    console.log(`Angelegt: ${template.name}`);
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
