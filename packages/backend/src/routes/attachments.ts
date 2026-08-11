import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
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
import { UPLOADS_DIR } from "../uploads.js";
import { hasRole, requireProjectAccess, scopedAssignedTo } from "../authorization.js";

const ALLOWED_MIME_PREFIXES = ["image/"];
const ALLOWED_MIME_EXACT = ["application/pdf"];

function isAllowedMime(mimeType: string): boolean {
  return (
    ALLOWED_MIME_EXACT.includes(mimeType) ||
    ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))
  );
}

export async function attachmentRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  server.post<{ Params: { id: string } }>(
    "/api/points/:id/attachments",
    async (request, reply) => {
      const point = getPointById(request.params.id);
      if (!point) {
        return reply.status(404).send({ error: "Punkt nicht gefunden" });
      }
      const plan = getPlanById(point.plan_id);
      if (plan) {
        if (!requireProjectAccess(request, reply, plan.project_id)) return;
      }
      if (!hasRole(request, ["mitarbeiter", "admin"])) {
        return reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
      }

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: "Datei ist erforderlich" });
      }
      if (!isAllowedMime(data.mimetype)) {
        return reply
          .status(400)
          .send({ error: "Nur Bilder oder PDF-Dateien sind erlaubt" });
      }

      const fileId = randomUUID();
      const extension = path.extname(data.filename) || "";
      const storedName = `${fileId}${extension}`;
      const filePath = path.join(UPLOADS_DIR, storedName);

      let sizeBytes = 0;
      await new Promise<void>((resolve, reject) => {
        const writeStream = createWriteStream(filePath);
        data.file.on("data", (chunk) => {
          sizeBytes += chunk.length;
        });
        data.file.pipe(writeStream);
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
      });

      const attachment = createAttachment({
        pointId: point.id,
        filePath: storedName,
        fileName: data.filename,
        mimeType: data.mimetype,
        sizeBytes,
        uploadedBy: request.user.sub,
      });
      return reply.status(201).send(attachment);
    }
  );

  server.get<{ Params: { id: string } }>(
    "/api/points/:id/attachments",
    async (request, reply) => {
      const point = getPointById(request.params.id);
      if (!point) {
        return reply.status(404).send({ error: "Punkt nicht gefunden" });
      }
      const plan = getPlanById(point.plan_id);
      if (plan) {
        if (!requireProjectAccess(request, reply, plan.project_id)) return;
      }
      return listAttachmentsForPoint(point.id);
    }
  );

  server.get<{ Params: { id: string } }>(
    "/api/projects/:id/attachments",
    async (request, reply) => {
      const project = getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      if (!requireProjectAccess(request, reply, project.id)) return;
      return listAttachmentsByProject(project.id, {
        assignedTo: scopedAssignedTo(request),
      });
    }
  );

  server.get<{ Params: { id: string } }>(
    "/api/attachments/:id/file",
    async (request, reply) => {
      const attachment = getAttachmentById(request.params.id);
      if (!attachment) {
        return reply.status(404).send({ error: "Datei nicht gefunden" });
      }
      const point = getPointById(attachment.point_id);
      const plan = point ? getPlanById(point.plan_id) : undefined;
      if (plan) {
        if (!requireProjectAccess(request, reply, plan.project_id)) return;
      }
      const absolutePath = path.join(UPLOADS_DIR, attachment.file_path);
      reply.header("Content-Type", attachment.mime_type);
      return reply.send(createReadStream(absolutePath));
    }
  );
}
