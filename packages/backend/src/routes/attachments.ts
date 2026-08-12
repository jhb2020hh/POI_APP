import { randomUUID } from "node:crypto";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { getPointById } from "../repositories/pointRepository.js";
import { getPlanById } from "../repositories/planRepository.js";
import { getProjectById } from "../repositories/projectRepository.js";
import {
  createAttachment,
  getAttachmentById,
  listAttachmentsByProject,
  listAttachmentsForPoint,
} from "../repositories/attachmentRepository.js";
import { ATTACHMENTS_BUCKET, supabaseAdmin } from "../supabase.js";
import { hasRole, requireProjectAccess, requireProjectWritable, scopedAssignedTo } from "../authorization.js";

const ALLOWED_MIME_PREFIXES = ["image/"];
const ALLOWED_MIME_EXACT = ["application/pdf"];
const SIGNED_URL_TTL_SECONDS = 60 * 60;

function isAllowedMime(mimeType: string): boolean {
  return (
    ALLOWED_MIME_EXACT.includes(mimeType) ||
    ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))
  );
}

export async function attachmentRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  // Schritt 1: signierte Upload-URL anfordern (siehe Begruendung in plans.ts).
  server.post<{ Params: { id: string }; Body: { fileName?: string; mimeType?: string } }>(
    "/api/points/:id/attachments/upload-url",
    async (request, reply) => {
      const point = await getPointById(request.params.id);
      if (!point) {
        return reply.status(404).send({ error: "Punkt nicht gefunden" });
      }
      const plan = await getPlanById(point.plan_id);
      if (plan) {
        if (!(await requireProjectWritable(request, reply, plan.project_id))) return;
      }
      if (!hasRole(request, ["mitarbeiter", "admin"])) {
        return reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
      }

      const { fileName, mimeType } = request.body ?? {};
      if (!mimeType || !isAllowedMime(mimeType)) {
        return reply.status(400).send({ error: "Nur Bilder oder PDF-Dateien sind erlaubt" });
      }

      const extension = fileName ? path.extname(fileName) : "";
      const storagePath = `${point.id}/${randomUUID()}${extension}`;
      const { data, error } = await supabaseAdmin.storage
        .from(ATTACHMENTS_BUCKET)
        .createSignedUploadUrl(storagePath);

      if (error || !data) {
        server.log.error({ error }, "Signierte Upload-URL konnte nicht erzeugt werden");
        return reply.status(502).send({ error: "Upload konnte nicht vorbereitet werden" });
      }

      return { bucket: ATTACHMENTS_BUCKET, path: data.path, token: data.token };
    }
  );

  // Schritt 2: hochgeladene Datei als Anhang registrieren.
  server.post<{
    Params: { id: string };
    Body: {
      filePath?: string;
      fileName?: string;
      mimeType?: string;
      sizeBytes?: number;
    };
  }>("/api/points/:id/attachments", async (request, reply) => {
    const point = await getPointById(request.params.id);
    if (!point) {
      return reply.status(404).send({ error: "Punkt nicht gefunden" });
    }
    const plan = await getPlanById(point.plan_id);
    if (plan) {
      if (!(await requireProjectWritable(request, reply, plan.project_id))) return;
    }
    if (!hasRole(request, ["mitarbeiter", "admin"])) {
      return reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
    }

    const { filePath, fileName, mimeType, sizeBytes } = request.body ?? {};
    if (!filePath || !fileName || !mimeType) {
      return reply
        .status(400)
        .send({ error: "filePath, fileName und mimeType sind erforderlich" });
    }
    if (!isAllowedMime(mimeType)) {
      return reply.status(400).send({ error: "Nur Bilder oder PDF-Dateien sind erlaubt" });
    }
    // Der Pfad stammt aus Schritt 1 und beginnt immer mit der Punkt-ID.
    if (!filePath.startsWith(`${point.id}/`)) {
      return reply.status(400).send({ error: "Ungültiger Dateipfad" });
    }

    const attachment = await createAttachment({
      pointId: point.id,
      filePath,
      fileName,
      mimeType,
      sizeBytes: sizeBytes ?? 0,
      uploadedBy: request.user.sub,
    });
    return reply.status(201).send(attachment);
  });

  server.get<{ Params: { id: string } }>(
    "/api/points/:id/attachments",
    async (request, reply) => {
      const point = await getPointById(request.params.id);
      if (!point) {
        return reply.status(404).send({ error: "Punkt nicht gefunden" });
      }
      const plan = await getPlanById(point.plan_id);
      if (plan) {
        if (!(await requireProjectAccess(request, reply, plan.project_id))) return;
      }
      return listAttachmentsForPoint(point.id);
    }
  );

  server.get<{ Params: { id: string } }>(
    "/api/projects/:id/attachments",
    async (request, reply) => {
      const project = await getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      if (!(await requireProjectAccess(request, reply, project.id))) return;
      return listAttachmentsByProject(project.id, {
        assignedTo: scopedAssignedTo(request),
      });
    }
  );

  server.get<{ Params: { id: string } }>(
    "/api/attachments/:id/file",
    async (request, reply) => {
      const attachment = await getAttachmentById(request.params.id);
      if (!attachment) {
        return reply.status(404).send({ error: "Datei nicht gefunden" });
      }
      const point = await getPointById(attachment.point_id);
      const plan = point ? await getPlanById(point.plan_id) : undefined;
      if (plan) {
        if (!(await requireProjectAccess(request, reply, plan.project_id))) return;
      }

      const { data, error } = await supabaseAdmin.storage
        .from(ATTACHMENTS_BUCKET)
        .createSignedUrl(attachment.file_path, SIGNED_URL_TTL_SECONDS);

      if (error || !data) {
        server.log.error({ error }, `Anhang ${attachment.id}: Datei fehlt im Storage`);
        return reply.status(404).send({ error: "Datei auf dem Server nicht (mehr) vorhanden" });
      }

      return reply.redirect(data.signedUrl, 302);
    }
  );
}
