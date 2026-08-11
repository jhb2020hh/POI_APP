import { randomUUID } from "node:crypto";
import { db } from "../db/connection.js";
import { deriveShortCode } from "../utils/shortCode.js";

export interface Category {
  id: string;
  project_id: string | null;
  name: string;
  color: string;
  glyph: string;
  short_code: string | null;
  field_schema_json: string;
  created_by: string | null;
  created_at: string;
  archived: number;
}

export function createCategory(input: {
  projectId: string | null;
  name: string;
  color?: string;
  glyph?: string;
  shortCode?: string;
  fieldSchemaJson?: string;
  createdBy?: string;
}): Category {
  const id = randomUUID();
  const shortCode = (input.shortCode?.trim() || deriveShortCode(input.name)).toUpperCase();
  db.prepare(
    `INSERT INTO categories (id, project_id, name, color, glyph, short_code, field_schema_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.projectId,
    input.name,
    input.color ?? "#e63946",
    input.glyph ?? "!",
    shortCode,
    input.fieldSchemaJson ?? '{"version":1,"fields":[]}',
    input.createdBy ?? null
  );
  return getCategoryById(id)!;
}

export function getCategoryById(id: string): Category | undefined {
  return db.prepare("SELECT * FROM categories WHERE id = ?").get(id) as
    | Category
    | undefined;
}

export function listCategoriesForProject(projectId: string): Category[] {
  return db
    .prepare(
      "SELECT * FROM categories WHERE archived = 0 AND (project_id IS NULL OR project_id = ?) ORDER BY created_at ASC"
    )
    .all(projectId) as unknown as Category[];
}

export function listGlobalCategories(): Category[] {
  return db
    .prepare("SELECT * FROM categories WHERE project_id IS NULL AND archived = 0 ORDER BY created_at ASC")
    .all() as unknown as Category[];
}

export function listArchivedGlobalCategories(): Category[] {
  return db
    .prepare("SELECT * FROM categories WHERE project_id IS NULL AND archived = 1 ORDER BY created_at DESC")
    .all() as unknown as Category[];
}

export function archiveCategory(id: string): boolean {
  const result = db.prepare("UPDATE categories SET archived = 1 WHERE id = ?").run(id);
  return result.changes > 0;
}

export function unarchiveCategory(id: string): boolean {
  const result = db.prepare("UPDATE categories SET archived = 0 WHERE id = ?").run(id);
  return result.changes > 0;
}

export interface UsedFieldDef {
  key: string;
  label: string;
  type: string;
}

export function listUsedFieldDefs(): UsedFieldDef[] {
  const rows = db.prepare("SELECT field_schema_json FROM categories").all() as {
    field_schema_json: string;
  }[];
  const byKey = new Map<string, UsedFieldDef>();
  for (const row of rows) {
    let parsed: { fields?: { key: string; label: string; type: string }[] };
    try {
      parsed = JSON.parse(row.field_schema_json);
    } catch {
      continue;
    }
    for (const field of parsed.fields ?? []) {
      if (!field.key || byKey.has(field.key)) continue;
      byKey.set(field.key, { key: field.key, label: field.label, type: field.type });
    }
  }
  return [...byKey.values()];
}
