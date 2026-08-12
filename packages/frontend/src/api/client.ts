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
import { isSupabaseConfigured, supabase } from "../supabase";

const CURRENT_USER_KEY = "poi_current_user";

export class AuthError extends Error {}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  /** Taegliche Erinnerungsmails zu Fristen - jeder schaltet sie fuer sich ab. */
  emailBenachrichtigungen?: boolean;
}

export async function setEmailBenachrichtigungen(aktiv: boolean): Promise<boolean> {
  const antwort = await authFetch('/api/me/benachrichtigungen', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailBenachrichtigungen: aktiv }),
  });
  const daten = await json<{ emailBenachrichtigungen: boolean }>(antwort);
  const aktuell = getCurrentUser();
  if (aktuell) {
    setCurrentUser({ ...aktuell, emailBenachrichtigungen: daten.emailBenachrichtigungen });
  }
  return daten.emailBenachrichtigungen;
}

/**
 * Der Zugriffstoken wird hier zwischengespeichert, damit getToken() synchron
 * bleibt: pdf.js, die Bildvorschau und der PDF-Export bauen ihre Header
 * unmittelbar beim Aufruf zusammen. supabase-js haelt den Wert ueber
 * onAuthStateChange aktuell, auch nach einer automatischen Erneuerung.
 *
 * initAuth() muss einmal vor dem ersten Rendern laufen (siehe main.tsx),
 * sonst waere direkt nach dem Seitenaufruf noch kein Token bekannt.
 */
let cachedToken: string | null = null;

export async function initAuth(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  cachedToken = data.session?.access_token ?? null;

  supabase.auth.onAuthStateChange((_event, session) => {
    cachedToken = session?.access_token ?? null;
    if (!session) clearCurrentUser();
  });

  // Es gibt Anmeldewege, die nicht ueber login() laufen - etwa ein Magic Link
  // oder eine Einladung, bei denen supabase-js die Sitzung direkt aus der URL
  // uebernimmt. Dann liegt zwar ein Token vor, aber weder Rolle noch
  // Anzeigename, und die App wuerde als angemeldet gelten ohne zu wissen, wer
  // da ist. Deshalb wird das Profil hier nachgeladen.
  if (cachedToken && !getCurrentUser()) {
    try {
      const user = await authFetch("/api/me").then((res) => json<CurrentUser>(res));
      setCurrentUser(user);
    } catch {
      // Schlaegt das fehl, bleibt die App beim Anmeldebildschirm - besser als
      // ein angemeldeter Zustand ohne bekannte Berechtigungen.
      cachedToken = null;
      clearCurrentUser();
    }
  }
}

export function getToken(): string | null {
  return cachedToken;
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
    cachedToken = null;
    clearCurrentUser();
    void supabase.auth.signOut();
    throw new AuthError("nicht authentifiziert");
  }
  return res;
}

/**
 * Wertet eine Antwort aus und macht Fehler benennbar.
 *
 * Frueher lautete die Meldung im Zweifel nur "HTTP 404" - ohne zu sagen, welche
 * Anfrage das war und wer geantwortet hat. Genau diese Unterscheidung ist aber
 * entscheidend: Antwortet die Anwendung (JSON mit `error`), liegt es an ihr;
 * kommt etwas anderes zurueck, hat die Anfrage sie nie erreicht und das Problem
 * liegt eine Ebene davor - bei der Auslieferung.
 */
/**
 * Fehler der Anwendung. `code` setzt das Backend dort, wo der Aufrufer den Fall
 * unterscheiden muss - etwa "wartet auf Freischaltung" gegenueber "keine
 * Berechtigung".
 */
export class ApiError extends Error {
  // Ausgeschriebene Felder statt Parameter-Eigenschaften: die Konfiguration
  // erlaubt nur Syntax, die sich rein durch Loeschen der Typen entfernen laesst
  // (erasableSyntaxOnly).
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const beschreibung = `${res.url ? new URL(res.url, location.origin).pathname : "?"} — HTTP ${res.status}`;

    const rohtext = await res.text().catch(() => "");
    let body: { error?: unknown; code?: unknown } | undefined;
    try {
      body = JSON.parse(rohtext) as { error?: unknown; code?: unknown };
    } catch {
      body = undefined;
    }

    if (typeof body?.error === "string") {
      const code = typeof body.code === "string" ? body.code : undefined;
      // Bei einem bekannten Fall bleibt die Meldung unveraendert - sie ist fuer
      // den Nutzer geschrieben und braucht keinen technischen Zusatz. Sonst
      // hilft der Pfad beim Eingrenzen.
      throw new ApiError(code ? body.error : `${body.error} (${beschreibung})`, res.status, code);
    }
    if (body) {
      throw new ApiError(`${beschreibung}: ${rohtext.slice(0, 200)}`, res.status);
    }
    throw new ApiError(`${beschreibung} — keine Antwort der Anwendung`, res.status);
  }
  return res.json() as Promise<T>;
}

/**
 * Die Anmeldung laeuft direkt gegen Supabase. Rolle und Anzeigename kennt
 * Supabase nicht - die stehen in der Profiltabelle und werden anschliessend
 * ueber /api/me nachgeladen.
 */
export async function login(email: string, password: string): Promise<CurrentUser> {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Die Anwendung ist nicht vollständig konfiguriert (Supabase-Zugangsdaten fehlen). Bitte an die Administration wenden."
    );
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(
      error?.message === "Invalid login credentials"
        ? "E-Mail oder Passwort falsch"
        : error?.message ?? "Anmeldung fehlgeschlagen"
    );
  }

  cachedToken = data.session.access_token;

  try {
    const user = await authFetch("/api/me").then((res) => json<CurrentUser>(res));
    setCurrentUser(user);
    return user;
  } catch (err) {
    // Anmeldung bei Supabase hat geklappt, die Anwendung laesst den Zugang aber
    // nicht zu. Die Sitzung wird verworfen - sonst bliebe ein angemeldeter
    // Zustand zurueck, in dem jede Anfrage scheitert.
    cachedToken = null;
    clearCurrentUser();
    await supabase.auth.signOut();
    throw err;
  }
}

/**
 * Selbstregistrierung. Das Konto entsteht bei Supabase; Profil und Rolle legt
 * das Backend beim ersten Anmelden an - gesperrt, bis ein Admin freischaltet.
 *
 * Rueckgabe sagt, ob Supabase eine Bestaetigungsmail verschickt hat: ist die
 * Bestaetigung im Projekt abgeschaltet, gibt es sofort eine Sitzung und der
 * Hinweis "schau in dein Postfach" waere falsch.
 */
export async function register(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<{ bestaetigungNoetig: boolean }> {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Die Anwendung ist nicht vollständig konfiguriert (Supabase-Zugangsdaten fehlen). Bitte an die Administration wenden."
    );
  }

  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: { data: { display_name: input.displayName } },
  });

  if (error) {
    throw new Error(
      error.message === "User already registered"
        ? "Für diese E-Mail-Adresse besteht bereits ein Konto."
        : error.message
    );
  }

  return { bestaetigungNoetig: !data.session };
}

export async function logout(): Promise<void> {
  cachedToken = null;
  clearCurrentUser();
  await supabase.auth.signOut();
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

/** Konten aus der Selbstregistrierung, die auf Freischaltung warten. */
export function listPendingUsers(): Promise<UserSummary[]> {
  return authFetch("/api/users/pending").then((res) => json(res));
}

export function approveUser(userId: string): Promise<void> {
  return authFetch(`/api/users/${userId}/approve`, { method: "POST" }).then(
    async (res) => {
      if (!res.ok) await json(res);
    }
  );
}

/** Ablehnen entfernt das Konto vollstaendig - siehe routes/users.ts. */
export function rejectUser(userId: string): Promise<void> {
  return authFetch(`/api/users/${userId}`, { method: "DELETE" }).then(
    async (res) => {
      if (!res.ok) await json(res);
    }
  );
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  added_at: string;
}

export function listProjectMembers(projectId: string): Promise<ProjectMember[]> {
  return authFetch(`/api/projects/${projectId}/members`).then((res) => json(res));
}

export async function addProjectMember(projectId: string, email: string): Promise<void> {
  const res = await authFetch(`/api/projects/${projectId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  // json() wirft bei einer Fehlerantwort mit der Meldung des Servers - genau
  // das wird hier gebraucht, der Rueckgabewert nicht.
  if (!res.ok) await json(res);
}

export async function removeProjectMember(projectId: string, userId: string): Promise<void> {
  const res = await authFetch(`/api/projects/${projectId}/members/${userId}`, {
    method: "DELETE",
  });
  if (!res.ok) await json(res);
}

export function listPlans(projectId: string): Promise<Plan[]> {
  if (!navigator.onLine) return getOfflinePlansByProject(projectId);
  return authFetch(`/api/projects/${projectId}/plans`).then((res) => json(res));
}

interface SignedUpload {
  bucket: string;
  path: string;
  token: string;
}

// Vorgabe des Supabase-Projekts (Free-Tarif: 50 MB). Wird sie ueberschritten,
// meldet die Ablage das in einer Form, die niemandem weiterhilft - deshalb hier
// vorab pruefen und im Klartext sagen, woran es liegt.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Laedt die Datei direkt zu Supabase Storage.
 *
 * Der Weg ueber die eigene API ist nicht moeglich, weil Vercel Request-Bodies
 * hart auf 4,5 MB begrenzt - Baupläne liegen regelmaessig darueber. Die API
 * stellt deshalb nur eine signierte URL aus und traegt die Datei danach in die
 * Datenbank ein.
 *
 * Hinweis zum Inhaltstyp: storage-js verpackt einen Blob - und eine File aus
 * dem Dateidialog ist einer - in FormData und setzt dabei keinen
 * content-type-Header. Der Typ, den Supabase sieht, stammt also aus der Datei
 * selbst; ein hier uebergebener contentType waere im Browser wirkungslos.
 */
async function uploadToStorage(signed: SignedUpload, file: File): Promise<void> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Die Datei ist ${formatMegabytes(file.size)} groß. Erlaubt sind ` +
        `${formatMegabytes(MAX_UPLOAD_BYTES)}.`
    );
  }

  const { error } = await supabase.storage
    .from(signed.bucket)
    .uploadToSignedUrl(signed.path, signed.token, file);
  if (error) {
    throw new Error(`Datei konnte nicht hochgeladen werden: ${error.message}`);
  }
}

// Die Pruefsumme wird nur fuer handliche Dateien berechnet: crypto.subtle
// braucht den gesamten Inhalt im Speicher, was bei sehr grossen Planen auf
// Mobilgeraeten zum Abbruch fuehren kann. Das Feld ist rein informativ.
const HASH_SIZE_LIMIT_BYTES = 25 * 1024 * 1024;

async function computeFileHash(file: File): Promise<string | undefined> {
  if (file.size > HASH_SIZE_LIMIT_BYTES) return undefined;
  try {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return undefined;
  }
}

export async function uploadPlan(
  projectId: string,
  name: string,
  file: File,
  bauabschnitt?: string
): Promise<Plan> {
  const signed = await authFetch(`/api/projects/${projectId}/plans/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name }),
  }).then((res) => json<SignedUpload>(res));

  await uploadToStorage(signed, file);

  return authFetch(`/api/projects/${projectId}/plans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      bauabschnitt,
      filePath: signed.path,
      fileHash: await computeFileHash(file),
    }),
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

export async function uploadAttachment(pointId: string, file: File): Promise<Attachment> {
  const mimeType = file.type || "application/octet-stream";

  const signed = await authFetch(`/api/points/${pointId}/attachments/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, mimeType }),
  }).then((res) => json<SignedUpload>(res));

  await uploadToStorage(signed, file);

  return authFetch(`/api/points/${pointId}/attachments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filePath: signed.path,
      fileName: file.name,
      mimeType,
      sizeBytes: file.size,
    }),
  }).then((res) => json(res));
}

export function attachmentFileUrl(attachmentId: string): string {
  return `/api/attachments/${attachmentId}/file`;
}

/**
 * Anhang samt der Angaben des Tickets, an dem er haengt - die Galerie zeigt
 * und sortiert danach. Muss zu AttachmentWithPoint in
 * packages/backend/src/repositories/attachmentRepository.ts passen.
 */
export type AttachmentWithPoint = Attachment & {
  plan_id: string;
  plan_name: string | null;
  point_title: string;
  category_id: string | null;
  ticket_number: string | null;
  point_status: string;
  assigned_to: string | null;
  gewerk: string | null;
};

export function listProjectAttachments(projectId: string): Promise<AttachmentWithPoint[]> {
  return authFetch(`/api/projects/${projectId}/attachments`).then((res) => json(res));
}

export interface ExportTemplate {
  id: string;
  project_id: string | null;
  name: string;
  columns_json: string;
  created_by: string | null;
  created_at: string;
  archived: number;
}

export function listExportTemplates(projectId: string): Promise<ExportTemplate[]> {
  return authFetch(`/api/projects/${projectId}/export-templates`).then((res) => json(res));
}

export function createExportTemplate(
  projectId: string,
  input: { name: string; columns: string[]; global?: boolean }
): Promise<ExportTemplate> {
  return authFetch(`/api/projects/${projectId}/export-templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export function updateExportTemplate(
  templateId: string,
  input: { name?: string; columns?: string[] }
): Promise<ExportTemplate> {
  return authFetch(`/api/export-templates/${templateId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export async function deleteExportTemplate(templateId: string): Promise<void> {
  const res = await authFetch(`/api/export-templates/${templateId}`, { method: "DELETE" });
  if (!res.ok) await json(res);
}

export async function downloadPointsCsv(
  projectId: string,
  filters: PointFilters & { planId?: string },
  templateId?: string
): Promise<void> {
  // Dieselbe Umsetzung wie fuer die Ansicht. Hier stand frueher eine eigene
  // Abschrift, in der Gewerk und Kategorie fehlten - die Datei enthielt dadurch
  // stillschweigend mehr Zeilen als die angezeigte Tabelle.
  const params = pointFilterParams(filters);
  if (templateId) params.set("templateId", templateId);

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

/**
 * Aendert eine bestehende Vorlage - projektgebunden wie zentral, der Server
 * entscheidet anhand der Vorlage selbst ueber die Berechtigung.
 *
 * shortCode fehlt absichtlich: er steckt in bereits vergebenen Ticketnummern
 * und laesst sich deshalb nicht mehr aendern.
 */
export function updateCategory(
  id: string,
  input: { name?: string; color?: string; glyph?: string; fieldSchemaJson?: string }
): Promise<Category> {
  return authFetch(`/api/categories/${id}`, {
    method: "PATCH",
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

export type PointWithPlan = Point & { plan_name: string | null };

/**
 * Setzt die Filter in Abfrageparameter um - an genau einer Stelle.
 *
 * Vorher baute jede Abfrage ihre Parameter selbst zusammen, und dabei fehlten
 * in der Variante fuer das Planfenster ausgerechnet `gewerk` und `categoryId`.
 * Mit gesetztem Gewerkfilter zeigte die Ansicht deshalb mehr Tickets, als der
 * Export danach ausgab. Ein neuer Filter wird jetzt hier eingetragen und wirkt
 * damit ueberall.
 */
function pointFilterParams(filters?: PointFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (!filters) return params;
  if (filters.planId) params.set("planId", filters.planId);
  if (filters.bauabschnitt) params.set("bauabschnitt", filters.bauabschnitt);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.status) params.set("status", filters.status);
  if (filters.assignedTo) params.set("assignedTo", filters.assignedTo);
  if (filters.gewerk) params.set("gewerk", filters.gewerk);
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  return params;
}

/**
 * Dieselbe Auswahl wie auf dem Server, nur lokal - fuer den Offline-Betrieb.
 *
 * Muss zu listPointsByProject in packages/backend/src/repositories/pointRepository.ts
 * passen. Bisher lieferte der Offline-Zweig die Tickets voellig ungefiltert
 * zurueck: sobald die Verbindung fehlte, ignorierte die Ansicht jeden Filter.
 */
function passtZuFiltern(point: Point, filters?: PointFilters): boolean {
  if (!filters) return true;
  if (filters.bauabschnitt && point.bauabschnitt !== filters.bauabschnitt) return false;
  if (filters.status && point.status !== filters.status) return false;
  if (filters.assignedTo && point.assigned_to !== filters.assignedTo) return false;
  if (filters.gewerk && point.gewerk !== filters.gewerk) return false;
  if (filters.categoryId && point.category_id !== filters.categoryId) return false;
  // Wie serverseitig ein Zeichenkettenvergleich auf created_at; `to` deckt den
  // ganzen Tag ab (siehe tagesEnde).
  if (filters.from && point.created_at < filters.from) return false;
  if (filters.to && point.created_at > tagesEnde(filters.to)) return false;
  return true;
}

/**
 * Macht aus einem reinen Datum das Ende dieses Tages - nur fuer den
 * Offline-Zweig.
 *
 * Online erledigt das der Server (bisTagesende in pointRepository.ts), weil der
 * Vergleich dort stattfindet. Ohne Verbindung wird hier verglichen, also wird
 * die Regel hier noch einmal gebraucht.
 */
function tagesEnde(datum: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(datum) ? `${datum}T23:59:59.999Z` : datum;
}

/**
 * Die Tickets eines Plans, so wie sie unter den aktuellen Filtern sichtbar sind.
 *
 * Einzige Quelle fuer diese Frage: Planfenster, Ticketliste und saemtliche
 * Ausgaben rufen dieselbe Funktion auf. Vorher liefen Ansicht und Export ueber
 * verschiedene Endpunkte mit verschiedenem Filterumfang - dass beide dieselbe
 * Menge zeigen, war damit nicht sichergestellt, sondern Zufall.
 */
export async function listVisiblePlanPoints(
  projectId: string,
  planId: string,
  filters?: PointFilters
): Promise<PointWithPlan[]> {
  if (!navigator.onLine) {
    const offline = await getOfflinePointsByPlan(planId);
    return offline
      .filter((point) => passtZuFiltern(point, filters))
      .map((point) => ({ ...point, plan_name: null }));
  }
  return listProjectPoints(projectId, { ...filters, planId });
}

export function listProjectPoints(projectId: string, filters?: PointFilters): Promise<PointWithPlan[]> {
  return authFetch(
    `/api/projects/${projectId}/points?${pointFilterParams(filters).toString()}`
  ).then((res) => json(res));
}

export function listArchivedProjects(): Promise<Project[]> {
  return authFetch("/api/projects/archived").then((res) => json(res));
}

export async function archiveProject(projectId: string): Promise<void> {
  const res = await authFetch(`/api/projects/${projectId}/archive`, { method: "POST" });
  if (!res.ok) await json(res);
}

export async function unarchiveProject(projectId: string): Promise<void> {
  const res = await authFetch(`/api/projects/${projectId}/unarchive`, { method: "POST" });
  if (!res.ok) await json(res);
}

/**
 * Loescht ein Projekt endgueltig - mit Tickets, Zeichnungen und Fotos.
 *
 * Der Server laesst das nur bei archivierten Projekten zu. Frueher archivierte
 * dieser Aufruf lediglich, hiess aber schon "loeschen"; jetzt tut er, was der
 * Name sagt.
 */
export async function deleteProject(projectId: string): Promise<void> {
  const res = await authFetch(`/api/projects/${projectId}`, { method: "DELETE" });
  if (!res.ok) await json(res);
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
