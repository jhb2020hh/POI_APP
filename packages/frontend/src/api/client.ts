import type {
  Attachment,
  Category,
  Plan,
  PlanFolder,
  Point,
  PointComment,
  PointHistoryEntry,
  PointStats,
  Project,
} from "@poi-app/shared";
import {
  addPendingChange,
  applyIncomingPoints,
  clearPendingChanges,
  getAllPendingChangeCount,
  getOfflinePlanProjectId,
  getOfflinePlansByProject,
  getOfflinePointsByPlan,
  getOfflineProjects,
  getPendingChanges,
  getSyncCursor,
  putLocalPoint,
  saveOfflineBundle,
  setSyncCursor,
} from "../offline/db";

const TOKEN_KEY = "poi_token";
const CURRENT_USER_KEY = "poi_current_user";

export class AuthError extends Error {}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function getCurrentUser(): CurrentUser | null {
  const raw = localStorage.getItem(CURRENT_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CurrentUser;
  } catch {
    return null;
  }
}

function setCurrentUser(user: CurrentUser): void {
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
}

function clearCurrentUser(): void {
  localStorage.removeItem(CURRENT_USER_KEY);
}

async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    clearCurrentUser();
    throw new AuthError("nicht authentifiziert");
  }
  return res;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function login(email: string, password: string): Promise<{ token: string; user: CurrentUser }> {
  return fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
    .then((res) => json<{ token: string; user: CurrentUser }>(res))
    .then((result) => {
      setToken(result.token);
      setCurrentUser(result.user);
      return result;
    });
}

export function logout(): void {
  clearToken();
  clearCurrentUser();
}

export function listProjects(): Promise<Project[]> {
  if (!navigator.onLine) return getOfflineProjects();
  return authFetch("/api/projects").then((res) => json(res));
}

export function listProjectStats(): Promise<PointStats[]> {
  return authFetch("/api/projects/stats").then((res) => json(res));
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  projectNumber: string;
  address?: string;
  customer?: string;
  status?: string;
  projectLead?: string;
}

export function createProject(input: CreateProjectInput): Promise<Project> {
  return authFetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export interface UserSummary {
  id: string;
  email: string;
  display_name: string;
  role: string;
}

export function listUsers(): Promise<UserSummary[]> {
  return authFetch("/api/users").then((res) => json(res));
}

export function createUser(input: {
  email: string;
  password: string;
  displayName: string;
  role: string;
}): Promise<UserSummary> {
  return authFetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  added_at: string;
}

export function listProjectMembers(projectId: string): Promise<ProjectMember[]> {
  return authFetch(`/api/projects/${projectId}/members`).then((res) => json(res));
}

export function addProjectMember(projectId: string, email: string): Promise<void> {
  return authFetch(`/api/projects/${projectId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  }).then((res) => {
    if (!res.ok) return json(res).then(() => undefined);
  });
}

export function listPlans(projectId: string): Promise<Plan[]> {
  if (!navigator.onLine) return getOfflinePlansByProject(projectId);
  return authFetch(`/api/projects/${projectId}/plans`).then((res) => json(res));
}

export function uploadPlan(
  projectId: string,
  name: string,
  file: File,
  bauabschnitt?: string
): Promise<Plan> {
  const formData = new FormData();
  formData.append("name", name);
  if (bauabschnitt) formData.append("bauabschnitt", bauabschnitt);
  formData.append("file", file);
  return authFetch(`/api/projects/${projectId}/plans`, {
    method: "POST",
    body: formData,
  }).then((res) => json(res));
}

export function planFileUrl(planId: string): string {
  return `/api/plans/${planId}/file`;
}

export function movePlanToFolder(planId: string, folderId: string | null): Promise<Plan> {
  return authFetch(`/api/plans/${planId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId }),
  }).then((res) => json(res));
}

export function listPlanFolders(projectId: string): Promise<PlanFolder[]> {
  return authFetch(`/api/projects/${projectId}/plan-folders`).then((res) => json(res));
}

export function createPlanFolder(
  projectId: string,
  name: string,
  parentFolderId?: string | null
): Promise<PlanFolder> {
  return authFetch(`/api/projects/${projectId}/plan-folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, parentFolderId: parentFolderId ?? null }),
  }).then((res) => json(res));
}

export function renamePlanFolder(folderId: string, name: string): Promise<PlanFolder> {
  return authFetch(`/api/plan-folders/${folderId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }).then((res) => json(res));
}

export function movePlanFolder(folderId: string, parentFolderId: string | null): Promise<PlanFolder> {
  return authFetch(`/api/plan-folders/${folderId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parentFolderId }),
  }).then((res) => json(res));
}

export function deletePlanFolder(folderId: string): Promise<void> {
  return authFetch(`/api/plan-folders/${folderId}`, { method: "DELETE" }).then(() => undefined);
}

export function listAttachments(pointId: string): Promise<Attachment[]> {
  return authFetch(`/api/points/${pointId}/attachments`).then((res) => json(res));
}

export function uploadAttachment(pointId: string, file: File): Promise<Attachment> {
  const formData = new FormData();
  formData.append("file", file);
  return authFetch(`/api/points/${pointId}/attachments`, {
    method: "POST",
    body: formData,
  }).then((res) => json(res));
}

export function attachmentFileUrl(attachmentId: string): string {
  return `/api/attachments/${attachmentId}/file`;
}

export type AttachmentWithPoint = Attachment & { plan_id: string; point_title: string; category_id: string | null };

export function listProjectAttachments(projectId: string): Promise<AttachmentWithPoint[]> {
  return authFetch(`/api/projects/${projectId}/attachments`).then((res) => json(res));
}

export async function downloadPointsCsv(
  projectId: string,
  filters: PointFilters & { planId?: string }
): Promise<void> {
  const params = new URLSearchParams();
  if (filters.planId) params.set("planId", filters.planId);
  if (filters.bauabschnitt) params.set("bauabschnitt", filters.bauabschnitt);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.status) params.set("status", filters.status);
  if (filters.assignedTo) params.set("assignedTo", filters.assignedTo);
  const res = await authFetch(
    `/api/projects/${projectId}/points/export.csv?${params.toString()}`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tickets-${projectId}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function listPointHistory(pointId: string): Promise<PointHistoryEntry[]> {
  return authFetch(`/api/points/${pointId}/history`).then((res) => json(res));
}

export function listPointComments(pointId: string): Promise<PointComment[]> {
  return authFetch(`/api/points/${pointId}/comments`).then((res) => json(res));
}

export function addPointComment(pointId: string, body: string): Promise<PointComment> {
  return authFetch(`/api/points/${pointId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  }).then((res) => json(res));
}

export function listCategories(projectId: string): Promise<Category[]> {
  return authFetch(`/api/projects/${projectId}/categories`).then((res) => json(res));
}

export function createCategory(
  projectId: string,
  input: { name: string; color?: string; glyph?: string; shortCode?: string; fieldSchemaJson?: string }
): Promise<Category> {
  return authFetch(`/api/projects/${projectId}/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export function listGlobalCategories(): Promise<Category[]> {
  return authFetch("/api/categories").then((res) => json(res));
}

export function createGlobalCategory(input: {
  name: string;
  color?: string;
  glyph?: string;
  shortCode?: string;
  fieldSchemaJson?: string;
}): Promise<Category> {
  return authFetch("/api/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export function archiveGlobalCategory(id: string): Promise<void> {
  return authFetch(`/api/categories/${id}`, { method: "DELETE" }).then(() => undefined);
}

export function listArchivedGlobalCategories(): Promise<Category[]> {
  return authFetch("/api/categories/archived").then((res) => json(res));
}

export function restoreGlobalCategory(id: string): Promise<void> {
  return authFetch(`/api/categories/${id}/restore`, { method: "POST" }).then(() => undefined);
}

export interface FieldSuggestion {
  key: string;
  label: string;
  type: string;
}

export function listFieldSuggestions(): Promise<FieldSuggestion[]> {
  return authFetch("/api/categories/field-suggestions").then((res) => json(res));
}

export interface PointFilters {
  planId?: string;
  bauabschnitt?: string;
  from?: string;
  to?: string;
  status?: string;
  assignedTo?: string;
  gewerk?: string;
  categoryId?: string;
}

export function listPoints(planId: string, filters?: PointFilters): Promise<Point[]> {
  if (!navigator.onLine) return getOfflinePointsByPlan(planId);
  const params = new URLSearchParams({ planId });
  if (filters?.bauabschnitt) params.set("bauabschnitt", filters.bauabschnitt);
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.assignedTo) params.set("assignedTo", filters.assignedTo);
  return authFetch(`/api/points?${params.toString()}`).then((res) => json(res));
}

export type PointWithPlan = Point & { plan_name: string | null };

export function listProjectPoints(projectId: string, filters?: PointFilters): Promise<PointWithPlan[]> {
  const params = new URLSearchParams();
  if (filters?.planId) params.set("planId", filters.planId);
  if (filters?.bauabschnitt) params.set("bauabschnitt", filters.bauabschnitt);
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.assignedTo) params.set("assignedTo", filters.assignedTo);
  if (filters?.gewerk) params.set("gewerk", filters.gewerk);
  if (filters?.categoryId) params.set("categoryId", filters.categoryId);
  return authFetch(`/api/projects/${projectId}/points?${params.toString()}`).then((res) => json(res));
}

export function deleteProject(projectId: string): Promise<void> {
  return authFetch(`/api/projects/${projectId}`, { method: "DELETE" }).then(() => undefined);
}

export function updateProjectDates(
  projectId: string,
  input: { baubeginn?: string | null; fertigstellung?: string | null }
): Promise<Project> {
  return authFetch(`/api/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export interface CompanyLetterhead {
  id: number;
  firma_name: string;
  adresse_zeile1: string;
  plz_ort: string;
  telefon: string;
  fax: string;
  email: string;
  geschaeftsfuehrer: string;
  sitz_gesellschaft: string;
  handelsregister: string;
  ust_idnr: string;
}

export function getLetterhead(): Promise<CompanyLetterhead> {
  return authFetch("/api/settings/letterhead").then((res) => json(res));
}

export function updateLetterhead(input: {
  firmaName?: string;
  adresseZeile1?: string;
  plzOrt?: string;
  telefon?: string;
  fax?: string;
  email?: string;
  geschaeftsfuehrer?: string;
  sitzGesellschaft?: string;
  handelsregister?: string;
  ustIdnr?: string;
}): Promise<CompanyLetterhead> {
  return authFetch("/api/settings/letterhead", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export async function makeProjectAvailableOffline(
  projectId: string,
  onProgress?: (message: string) => void
): Promise<void> {
  onProgress?.("Lade Projektdaten...");
  const bundle = await authFetch(`/api/projects/${projectId}/offline-bundle`).then((res) =>
    json<{
      project: Project;
      plans: Plan[];
      pointsByPlan: Record<string, Point[]>;
      syncCursor: number;
    }>(res)
  );

  onProgress?.("Lade Pläne für Offline-Nutzung...");
  const token = getToken();
  for (const plan of bundle.plans) {
    if (!plan.file_path) continue;
    await fetch(planFileUrl(plan.id), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
  }

  onProgress?.("Speichere Daten lokal...");
  await saveOfflineBundle(bundle);
  onProgress?.("Projekt ist offline verfügbar.");
}

export async function createPoint(input: {
  id: string;
  planId: string;
  x: number;
  y: number;
  title: string;
  description?: string;
  pointType?: string;
  categoryId?: string;
  customFields?: Record<string, string | number | boolean>;
  bauabschnitt?: string;
  priority?: string;
  assignedTo?: string;
  dueDate?: string;
  gewerk?: string;
  raumBereich?: string;
}): Promise<Point> {
  if (!navigator.onLine) {
    const projectId = await getOfflinePlanProjectId(input.planId);
    const now = new Date().toISOString();
    const point: Point = {
      id: input.id,
      plan_id: input.planId,
      page_number: 1,
      x: input.x,
      y: input.y,
      point_type: input.pointType ?? "defect",
      category_id:
        input.categoryId ?? (input.pointType === "clarification" ? "cat-clarification" : "cat-defect"),
      custom_fields: input.customFields ? JSON.stringify(input.customFields) : null,
      status: "open",
      title: input.title,
      description: input.description ?? null,
      bauabschnitt: input.bauabschnitt ?? null,
      priority: input.priority ?? null,
      assigned_to: input.assignedTo ?? null,
      due_date: input.dueDate ?? null,
      gewerk: input.gewerk ?? null,
      raum_bereich: input.raumBereich ?? null,
      ticket_number: null,
      created_by: null,
      created_at: now,
      updated_by: null,
      updated_at: now,
      version: 1,
      deleted: 0,
    };
    await putLocalPoint(point);
    if (projectId) {
      await addPendingChange({ projectId, op: "create", point: input });
    }
    return point;
  }
  return authFetch("/api/points", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export interface UpdatePointResponse extends Point {
  conflict: boolean;
  previousValue?: Point;
}

export async function updatePoint(
  id: string,
  input: {
    title?: string;
    description?: string;
    pointType?: string;
    categoryId?: string;
    customFields?: Record<string, string | number | boolean>;
    status?: string;
    bauabschnitt?: string;
    priority?: string;
    assignedTo?: string;
    dueDate?: string;
    gewerk?: string;
    raumBereich?: string;
    version?: number;
    planId?: string;
  }
): Promise<UpdatePointResponse> {
  if (!navigator.onLine) {
    const planId = input.planId;
    if (!planId) throw new Error("planId ist im Offline-Modus erforderlich");
    const existingPoints = await getOfflinePointsByPlan(planId);
    const existing = existingPoints.find((p) => p.id === id);
    const now = new Date().toISOString();
    const updated: Point = {
      ...(existing ?? {
        id,
        plan_id: planId,
        page_number: 1,
        x: 0,
        y: 0,
        point_type: "defect",
        category_id: null,
        custom_fields: null,
        status: "open",
        description: null,
        bauabschnitt: null,
        priority: null,
        assigned_to: null,
        due_date: null,
        gewerk: null,
        raum_bereich: null,
        created_by: null,
        created_at: now,
        version: 1,
        deleted: 0,
      }),
      title: input.title ?? existing?.title ?? "",
      description: input.description ?? existing?.description ?? null,
      point_type: input.pointType ?? existing?.point_type ?? "defect",
      category_id: input.categoryId ?? existing?.category_id ?? null,
      custom_fields: input.customFields
        ? JSON.stringify(input.customFields)
        : existing?.custom_fields ?? null,
      status: input.status ?? existing?.status ?? "open",
      bauabschnitt: input.bauabschnitt ?? existing?.bauabschnitt ?? null,
      priority: input.priority ?? existing?.priority ?? null,
      assigned_to: input.assignedTo ?? existing?.assigned_to ?? null,
      due_date: input.dueDate ?? existing?.due_date ?? null,
      gewerk: input.gewerk ?? existing?.gewerk ?? null,
      raum_bereich: input.raumBereich ?? existing?.raum_bereich ?? null,
      updated_at: now,
      updated_by: null,
    } as Point;
    await putLocalPoint(updated);
    const projectId = await getOfflinePlanProjectId(planId);
    if (projectId) {
      await addPendingChange({
        projectId,
        op: "update",
        point: {
          id,
          planId,
          title: input.title,
          description: input.description,
          pointType: input.pointType,
          categoryId: input.categoryId,
          customFields: input.customFields,
          bauabschnitt: input.bauabschnitt,
          priority: input.priority,
          assignedTo: input.assignedTo,
          dueDate: input.dueDate,
          gewerk: input.gewerk,
          raumBereich: input.raumBereich,
          version: input.version,
        },
      });
    }
    return { ...updated, conflict: false };
  }
  return authFetch(`/api/points/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export async function deletePoint(id: string, planId?: string): Promise<void> {
  if (!navigator.onLine) {
    if (!planId) throw new Error("planId ist im Offline-Modus erforderlich");
    const existingPoints = await getOfflinePointsByPlan(planId);
    const existing = existingPoints.find((p) => p.id === id);
    if (existing) {
      await putLocalPoint({ ...existing, deleted: 1 });
    }
    const projectId = await getOfflinePlanProjectId(planId);
    if (projectId) {
      await addPendingChange({ projectId, op: "delete", point: { id, planId } });
    }
    return;
  }
  await authFetch(`/api/points/${id}`, { method: "DELETE" }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });
}

export interface SyncSummary {
  pushed: number;
  applied: number;
  conflicts: number;
  errors: number;
  pulled: number;
}

export async function syncProject(projectId: string): Promise<SyncSummary> {
  const pending = await getPendingChanges(projectId);
  const summary: SyncSummary = { pushed: pending.length, applied: 0, conflicts: 0, errors: 0, pulled: 0 };

  if (pending.length > 0) {
    const res = await authFetch(`/api/sync/${projectId}/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: pending.map((c) => ({ localId: c.localId, op: c.op, point: c.point })),
      }),
    });
    const body = await json<{
      results: { localId: string; status: "applied" | "conflict" | "error" }[];
      newCursor: number;
    }>(res);

    const toClear: string[] = [];
    for (const result of body.results) {
      if (result.status === "applied") {
        summary.applied++;
        toClear.push(result.localId);
      } else if (result.status === "conflict") {
        summary.conflicts++;
        toClear.push(result.localId);
      } else {
        summary.errors++;
      }
    }
    await clearPendingChanges(toClear);
  }

  const cursor = await getSyncCursor(projectId);
  const pullRes = await authFetch(`/api/sync/${projectId}/changes?since=${cursor}`);
  const pullBody = await json<{ points: Point[]; newCursor: number }>(pullRes);
  await applyIncomingPoints(pullBody.points);
  await setSyncCursor(projectId, pullBody.newCursor);
  summary.pulled = pullBody.points.length;

  return summary;
}

export function getPendingChangeCount(): Promise<number> {
  return getAllPendingChangeCount();
}
