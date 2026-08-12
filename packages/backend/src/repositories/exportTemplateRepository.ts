import { randomUUID } from "node:crypto";
import { db } from "../db/connection.js";

export interface ExportTemplate {
  id: string;
  /** null = gilt in allen Projekten, wie bei den zentralen Ticketvorlagen. */
  project_id: string | null;
  name: string;
  columns_json: string;
  created_by: string | null;
  created_at: string;
  archived: number;
}

export async function createExportTemplate(input: {
  projectId: string | null;
  name: string;
  columns: string[];
  createdBy?: string;
}): Promise<ExportTemplate> {
  const id = randomUUID();
  await db
    .prepare(
      `INSERT INTO export_templates (id, project_id, name, columns_json, created_by)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.projectId,
      input.name,
      JSON.stringify(input.columns),
      input.createdBy ?? null
    );
  return (await getExportTemplateById(id))!;
}

export async function getExportTemplateById(
  id: string
): Promise<ExportTemplate | undefined> {
  return db
    .prepare("SELECT * FROM export_templates WHERE id = ?")
    .get<ExportTemplate>(id);
}

/**
 * Vorlagen, die in einem Projekt zur Verfuegung stehen: die eigenen und die
 * projektuebergreifenden. Dieselbe Regel wie listCategoriesForProject.
 */
export async function listExportTemplatesForProject(
  projectId: string
): Promise<ExportTemplate[]> {
  return db
    .prepare(
      `SELECT * FROM export_templates
       WHERE archived = 0 AND (project_id IS NULL OR project_id = ?)
       ORDER BY created_at ASC`
    )
    .all<ExportTemplate>(projectId);
}

export async function updateExportTemplate(
  id: string,
  input: { name?: string; columns?: string[] }
): Promise<ExportTemplate | undefined> {
  const zuweisungen: string[] = [];
  const params: (string | number)[] = [];

  if (input.name !== undefined) {
    zuweisungen.push("name = ?");
    params.push(input.name);
  }
  if (input.columns !== undefined) {
    zuweisungen.push("columns_json = ?");
    params.push(JSON.stringify(input.columns));
  }
  if (zuweisungen.length === 0) return getExportTemplateById(id);

  params.push(id);
  const ergebnis = await db
    .prepare(`UPDATE export_templates SET ${zuweisungen.join(", ")} WHERE id = ?`)
    .run(...params);
  if (ergebnis.changes === 0) return undefined;
  return getExportTemplateById(id);
}

/**
 * Archivieren statt loeschen - eine Vorlage kann in einer Absprache stecken
 * ("exportiere mir das nach Vorlage Abnahme"), und ein versehentliches Loeschen
 * waere sonst endgueltig.
 */
export async function archiveExportTemplate(id: string): Promise<boolean> {
  const ergebnis = await db
    .prepare("UPDATE export_templates SET archived = 1 WHERE id = ?")
    .run(id);
  return ergebnis.changes > 0;
}
