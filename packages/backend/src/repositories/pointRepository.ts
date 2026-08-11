import { db } from "../db/connection.js";
import { recordFieldChange } from "./pointHistoryRepository.js";
import { createNotification } from "./notificationRepository.js";
import { resolveCategoryCode } from "../utils/shortCode.js";

export interface Point {
  id: string;
  plan_id: string;
  page_number: number;
  x: number;
  y: number;
  point_type: string;
  category_id: string | null;
  custom_fields: string | null;
  status: string;
  title: string;
  description: string | null;
  bauabschnitt: string | null;
  priority: string | null;
  assigned_to: string | null;
  due_date: string | null;
  gewerk: string | null;
  raum_bereich: string | null;
  ticket_number: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
  version: number;
  deleted: number;
}

// Vergibt die naechste laufende Nummer je Projekt+Ticketart atomar (node:sqlite
// ist synchron/single-threaded, daher reicht das ohne explizite Transaktion aus -
// zwischen den beiden Statements kann kein anderer Request dazwischenfunken).
function allocateTicketSequence(projectId: string, categoryCode: string): number {
  db.prepare(
    `INSERT INTO ticket_number_counters (project_id, category_code, next_number) VALUES (?, ?, 1)
     ON CONFLICT(project_id, category_code) DO NOTHING`
  ).run(projectId, categoryCode);
  const row = db
    .prepare(
      `UPDATE ticket_number_counters SET next_number = next_number + 1
       WHERE project_id = ? AND category_code = ?
       RETURNING next_number - 1 AS assigned`
    )
    .get(projectId, categoryCode) as { assigned: number };
  return row.assigned;
}

// Baut die menschenlesbare Ticket-ID PROJEKTNR-TICKETART-0007. Bleibt null,
// wenn das Projekt (noch) keine Projektnummer hat - dann gibt es keinen
// sinnvollen Praefix, das Ticket bekommt seine Nummer erst nachtraeglich nicht
// automatisch (Projektnummer muesste zuerst gepflegt werden).
function buildTicketNumber(planId: string, categoryId: string | null): string | null {
  const plan = db.prepare("SELECT project_id FROM plans WHERE id = ?").get(planId) as
    | { project_id: string }
    | undefined;
  if (!plan) return null;
  const project = db.prepare("SELECT project_number FROM projects WHERE id = ?").get(plan.project_id) as
    | { project_number: string | null }
    | undefined;
  if (!project?.project_number) return null;

  const category = categoryId
    ? (db.prepare("SELECT short_code, name FROM categories WHERE id = ?").get(categoryId) as
        | { short_code: string | null; name: string }
        | undefined)
    : undefined;
  const categoryCode = resolveCategoryCode(category);
  const sequence = allocateTicketSequence(plan.project_id, categoryCode);
  return `${project.project_number}-${categoryCode}-${String(sequence).padStart(4, "0")}`;
}

export function createPoint(input: {
  id: string;
  planId: string;
  pageNumber?: number;
  x: number;
  y: number;
  pointType?: string;
  categoryId?: string;
  customFields?: string;
  title: string;
  description?: string;
  bauabschnitt?: string;
  priority?: string;
  assignedTo?: string;
  dueDate?: string;
  gewerk?: string;
  raumBereich?: string;
  createdBy?: string;
}): Point {
  const now = new Date().toISOString();
  const resolvedCategoryId =
    input.categoryId ?? (input.pointType === "clarification" ? "cat-clarification" : "cat-defect");
  const ticketNumber = buildTicketNumber(input.planId, resolvedCategoryId);
  db.prepare(
    `INSERT INTO points
      (id, plan_id, page_number, x, y, point_type, category_id, custom_fields, title, description, bauabschnitt,
       priority, assigned_to, due_date, gewerk, raum_bereich, ticket_number, created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    input.planId,
    input.pageNumber ?? 1,
    input.x,
    input.y,
    input.pointType ?? "defect",
    resolvedCategoryId,
    input.customFields ?? null,
    input.title,
    input.description ?? null,
    input.bauabschnitt ?? null,
    input.priority ?? null,
    input.assignedTo ?? null,
    input.dueDate ?? null,
    input.gewerk ?? null,
    input.raumBereich ?? null,
    ticketNumber,
    input.createdBy ?? null,
    now,
    input.createdBy ?? null,
    now
  );
  return getPointById(input.id)!;
}

export function getPointById(id: string): Point | undefined {
  return db.prepare("SELECT * FROM points WHERE id = ?").get(id) as
    | Point
    | undefined;
}

export function listPointsByPlan(
  planId: string,
  filters?: {
    bauabschnitt?: string;
    from?: string;
    to?: string;
    status?: string;
    assignedTo?: string;
  }
): Point[] {
  const conditions = ["plan_id = ?", "deleted = 0"];
  const params: (string | number)[] = [planId];

  if (filters?.bauabschnitt) {
    conditions.push("bauabschnitt = ?");
    params.push(filters.bauabschnitt);
  }
  if (filters?.from) {
    conditions.push("created_at >= ?");
    params.push(filters.from);
  }
  if (filters?.to) {
    conditions.push("created_at <= ?");
    params.push(filters.to);
  }
  if (filters?.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters?.assignedTo) {
    conditions.push("assigned_to = ?");
    params.push(filters.assignedTo);
  }

  return db
    .prepare(
      `SELECT * FROM points WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC`
    )
    .all(...params) as unknown as Point[];
}

export function listPointsByProject(
  projectId: string,
  filters?: {
    planId?: string;
    bauabschnitt?: string;
    from?: string;
    to?: string;
    status?: string;
    assignedTo?: string;
    gewerk?: string;
    categoryId?: string;
  }
): Point[] {
  const conditions = ["plans.project_id = ?", "points.deleted = 0"];
  const params: (string | number)[] = [projectId];

  if (filters?.planId) {
    conditions.push("points.plan_id = ?");
    params.push(filters.planId);
  }
  if (filters?.bauabschnitt) {
    conditions.push("points.bauabschnitt = ?");
    params.push(filters.bauabschnitt);
  }
  if (filters?.from) {
    conditions.push("points.created_at >= ?");
    params.push(filters.from);
  }
  if (filters?.to) {
    conditions.push("points.created_at <= ?");
    params.push(filters.to);
  }
  if (filters?.status) {
    conditions.push("points.status = ?");
    params.push(filters.status);
  }
  if (filters?.assignedTo) {
    conditions.push("points.assigned_to = ?");
    params.push(filters.assignedTo);
  }
  if (filters?.gewerk) {
    conditions.push("points.gewerk = ?");
    params.push(filters.gewerk);
  }
  if (filters?.categoryId) {
    conditions.push("points.category_id = ?");
    params.push(filters.categoryId);
  }

  return db
    .prepare(
      `SELECT points.* FROM points
       JOIN plans ON plans.id = points.plan_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY points.created_at ASC`
    )
    .all(...params) as unknown as Point[];
}

const STATUS_KEYS = ["open", "in_bearbeitung", "geprueft", "erledigt", "abgeschlossen"];
const OPEN_STATUSES = new Set(["open", "in_bearbeitung", "geprueft"]);

export interface PointStats {
  projectId: string;
  total: number;
  byStatus: Record<string, number>;
  overdue: number;
}

export function summarizePointStats(projectId: string, points: Point[]): PointStats {
  const byStatus: Record<string, number> = {};
  for (const key of STATUS_KEYS) byStatus[key] = 0;

  const today = new Date().toISOString().slice(0, 10);
  let overdue = 0;

  for (const point of points) {
    byStatus[point.status] = (byStatus[point.status] ?? 0) + 1;
    if (point.due_date && point.due_date < today && OPEN_STATUSES.has(point.status)) {
      overdue += 1;
    }
  }

  return { projectId, total: points.length, byStatus, overdue };
}

export interface UpdatePointResult {
  point: Point;
  conflict: boolean;
  previousValue: Point;
}

const TRACKED_FIELDS = [
  "title",
  "description",
  "point_type",
  "category_id",
  "status",
  "bauabschnitt",
  "priority",
  "assigned_to",
  "due_date",
  "gewerk",
  "raum_bereich",
] as const;

export function updatePoint(
  id: string,
  input: {
    title?: string;
    description?: string;
    pointType?: string;
    categoryId?: string;
    customFields?: string;
    status?: string;
    bauabschnitt?: string;
    priority?: string;
    assignedTo?: string;
    dueDate?: string;
    gewerk?: string;
    raumBereich?: string;
    x?: number;
    y?: number;
    updatedBy?: string;
    expectedVersion?: number;
    source?: "online" | "offline-sync";
  }
): UpdatePointResult | undefined {
  const existing = getPointById(id);
  if (!existing) return undefined;

  const conflict =
    input.expectedVersion !== undefined &&
    input.expectedVersion !== existing.version;

  db.prepare(
    `UPDATE points SET
      title = ?, description = ?, point_type = ?, category_id = ?, custom_fields = ?, status = ?, bauabschnitt = ?,
      priority = ?, assigned_to = ?, due_date = ?, gewerk = ?, raum_bereich = ?, x = ?, y = ?,
      updated_by = ?, updated_at = ?, version = version + 1
     WHERE id = ?`
  ).run(
    input.title ?? existing.title,
    input.description ?? existing.description,
    input.pointType ?? existing.point_type,
    input.categoryId ?? existing.category_id,
    input.customFields ?? existing.custom_fields,
    input.status ?? existing.status,
    input.bauabschnitt ?? existing.bauabschnitt,
    input.priority ?? existing.priority,
    input.assignedTo ?? existing.assigned_to,
    input.dueDate ?? existing.due_date,
    input.gewerk ?? existing.gewerk,
    input.raumBereich ?? existing.raum_bereich,
    input.x ?? existing.x,
    input.y ?? existing.y,
    input.updatedBy ?? null,
    new Date().toISOString(),
    id
  );

  const updated = getPointById(id)!;

  for (const field of TRACKED_FIELDS) {
    const oldValue = existing[field as keyof Point];
    const newValue = updated[field as keyof Point];
    if (oldValue !== newValue) {
      recordFieldChange({
        pointId: id,
        changedBy: input.updatedBy,
        fieldChanged: field,
        oldValue: oldValue === null ? null : String(oldValue),
        newValue: newValue === null ? null : String(newValue),
        source: input.source,
      });
    }
  }

  if (updated.assigned_to && updated.assigned_to !== existing.assigned_to) {
    const plan = db
      .prepare("SELECT project_id FROM plans WHERE id = ?")
      .get(updated.plan_id) as { project_id: string } | undefined;
    if (plan) {
      createNotification({
        projectId: plan.project_id,
        pointId: updated.id,
        recipientId: updated.assigned_to,
        type: "assigned",
        message: `Ticket "${updated.title}" wurde dir zugewiesen.`,
      });
    }
  }

  return { point: updated, conflict, previousValue: existing };
}

export function softDeletePoint(id: string): boolean {
  const result = db
    .prepare("UPDATE points SET deleted = 1, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
  return result.changes > 0;
}
