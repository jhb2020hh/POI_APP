import { runMigrations } from "../db/migrate.js";
import { db } from "../db/connection.js";
import { createCategory } from "../repositories/categoryRepository.js";

runMigrations();

const TEMPLATES: { name: string; color: string; glyph: string }[] = [
  { name: "Brandschutzdokumentation", color: "#e63946", glyph: "🔥" },
  { name: "Kernbohrungen", color: "#457b9d", glyph: "⊙" },
  { name: "Planprüfung", color: "#2a9d8f", glyph: "✓" },
  { name: "Zustandsfeststellung", color: "#e9c46a", glyph: "!" },
  { name: "Arbeitssicherheit", color: "#f4a261", glyph: "⚠" },
];

const existing = db
  .prepare("SELECT name FROM categories WHERE project_id IS NULL")
  .all() as { name: string }[];
const existingNames = new Set(existing.map((row) => row.name));

for (const template of TEMPLATES) {
  if (existingNames.has(template.name)) {
    console.log(`Übersprungen (existiert bereits): ${template.name}`);
    continue;
  }
  createCategory({
    projectId: null,
    name: template.name,
    color: template.color,
    glyph: template.glyph,
  });
  console.log(`Angelegt: ${template.name}`);
}
