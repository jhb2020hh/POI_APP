import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { getProjectById } from "../repositories/projectRepository.js";
import {
  createPlan,
  getPlanById,
  listPlansByProject,
  updatePlanFolder,
} from "../repositories/planRepository.js";
import { PLANS_BUCKET, supabaseAdmin } from "../supabase.js";
import { hasRole, requireProjectAccess, requireProjectWritable } from "../authorization.js";

// Gueltigkeit der Download-Links. Kurz genug, dass ein weitergereichter Link
// nicht dauerhaft Zugriff gewaehrt, lang genug fuer das Oeffnen grosser Plaene
// und das Befuellen des Offline-Caches.
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export async function planRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  /**
   * Schritt 1 des Uploads: der Client bekommt eine signierte URL und laedt die
   * Datei direkt zu Supabase Storage.
   *
   * Der Umweg ist noetig, weil Vercel Request-Bodies hart auf 4,5 MB begrenzt -
   * Baupläne liegen regelmaessig darueber und wuerden beim Weg ueber die API
   * abgewiesen.
   */
  server.post<{ Params: { id: string } }>(
    "/api/projects/:id/plans/upload-url",
    async (request, reply) => {
      const project = await getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      if (!(await requireProjectWritable(request, reply, project.id))) return;
      if (!hasRole(request, ["mitarbeiter", "admin"])) {
        return reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
      }

      const storagePath = `${project.id}/${randomUUID()}.pdf`;
      const { data, error } = await supabaseAdmin.storage
        .from(PLANS_BUCKET)
        .createSignedUploadUrl(storagePath);

      if (error || !data) {
        server.log.error({ error }, "Signierte Upload-URL konnte nicht erzeugt werden");
        return reply.status(502).send({ error: "Upload konnte nicht vorbereitet werden" });
      }

      return { bucket: PLANS_BUCKET, path: data.path, token: data.token };
    }
  );

  // Schritt 2: die hochgeladene Datei wird als Plan registriert.
  server.post<{
    Params: { id: string };
    Body: {
      name?: string;
      bauabschnitt?: string;
      filePath?: string;
      fileHash?: string;
    };
  }>("/api/projects/:id/plans", async (request, reply) => {
    const project = await getProjectById(request.params.id);
    if (!project) {
      return reply.status(404).send({ error: "Projekt nicht gefunden" });
    }
    if (!(await requireProjectWritable(request, reply, project.id))) return;
    if (!hasRole(request, ["mitarbeiter", "admin"])) {
      return reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
    }

    const { name, bauabschnitt, filePath, fileHash } = request.body ?? {};
    if (!filePath) {
      return reply.status(400).send({ error: "filePath ist erforderlich" });
    }
    // Der Pfad wird vom Server vergeben und beginnt deshalb immer mit der
    // Projekt-ID. Die Pruefung verhindert, dass ein Client einen Plan auf eine
    // Datei eines fremden Projekts zeigen laesst.
    if (!filePath.startsWith(`${project.id}/`)) {
      return reply.status(400).send({ error: "Ungültiger Dateipfad" });
    }
    if (!name) {
      return reply.status(400).send({ error: "name ist erforderlich" });
    }

    const plan = await createPlan({
      projectId: project.id,
      name,
      bauabschnitt,
      filePath,
      fileHash,
      uploadedBy: request.user.sub,
    });
    return reply.status(201).send(plan);
  });

  server.get<{ Params: { id: string } }>(
    "/api/projects/:id/plans",
    async (request, reply) => {
      const project = await getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      if (!(await requireProjectAccess(request, reply, project.id))) return;
      return listPlansByProject(project.id);
    }
  );

  server.patch<{ Params: { id: string }; Body: { folderId?: string | null } }>(
    "/api/plans/:id",
    async (request, reply) => {
      const plan = await getPlanById(request.params.id);
      if (!plan) {
        return reply.status(404).send({ error: "Plan nicht gefunden" });
      }
      if (!(await requireProjectWritable(request, reply, plan.project_id))) return;
      if (!hasRole(request, ["mitarbeiter", "admin"])) {
        return reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
      }
      if (!("folderId" in request.body)) {
        return reply.status(400).send({ error: "folderId ist erforderlich" });
      }
      return updatePlanFolder(plan.id, request.body.folderId ?? null);
    }
  );

  /**
   * Die Berechtigung wird weiterhin hier geprueft; ausgeliefert wird die Datei
   * dann per Weiterleitung auf eine kurzlebige, signierte Storage-URL. Der
   * API-Pfad bleibt dadurch stabil - Service Worker, pdf.js und der PDF-Export
   * arbeiten unveraendert gegen /api/plans/:id/file.
   */
  server.get<{ Params: { id: string } }>(
    "/api/plans/:id/file",
    async (request, reply) => {
      const plan = await getPlanById(request.params.id);
      if (!plan) {
        server.log.warn(`Plan-Datei angefragt, aber Plan ${request.params.id} existiert nicht`);
        return reply.status(404).send({ error: "Plan nicht gefunden" });
      }
      if (!plan.file_path) {
        server.log.warn(`Plan ${plan.id} hat keinen file_path in der Datenbank`);
        return reply.status(404).send({ error: "Für diesen Plan ist keine Datei hinterlegt" });
      }
      if (!(await requireProjectAccess(request, reply, plan.project_id))) return;

      const { data, error } = await supabaseAdmin.storage
        .from(PLANS_BUCKET)
        .createSignedUrl(plan.file_path, SIGNED_URL_TTL_SECONDS);

      if (error || !data) {
        server.log.error(
          { error },
          `Plan ${plan.id}: Datenbank verweist auf ${plan.file_path}, Datei fehlt im Storage`
        );
        return reply.status(404).send({ error: "Datei auf dem Server nicht (mehr) vorhanden" });
      }

      return reply.redirect(data.signedUrl, 302);
    }
  );
}
