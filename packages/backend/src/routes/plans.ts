import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { getProjectById } from "../repositories/projectRepository.js";
import {
  createPlan,
  getPlanById,
  listPlansByProject,
  updatePlanFolder,
} from "../repositories/planRepository.js";
import { UPLOADS_DIR } from "../uploads.js";
import { hasRole, requireProjectAccess } from "../authorization.js";

export async function planRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  server.post<{ Params: { id: string } }>(
    "/api/projects/:id/plans",
    async (request, reply) => {
      const project = getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      if (!requireProjectAccess(request, reply, project.id)) return;
      if (!hasRole(request, ["mitarbeiter", "admin"])) {
        return reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
      }

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: "PDF-Datei ist erforderlich" });
      }

      const nameField = data.fields.name;
      const name =
        nameField && "value" in nameField
          ? String(nameField.value)
          : data.filename;
      const bauabschnittField = data.fields.bauabschnitt;
      const bauabschnitt =
        bauabschnittField && "value" in bauabschnittField
          ? String(bauabschnittField.value)
          : undefined;

      const fileId = randomUUID();
      const filePath = path.join(UPLOADS_DIR, `${fileId}.pdf`);
      const hash = createHash("sha256");

      await new Promise<void>((resolve, reject) => {
        const writeStream = createWriteStream(filePath);
        data.file.on("data", (chunk) => hash.update(chunk));
        data.file.pipe(writeStream);
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
      });

      const plan = createPlan({
        projectId: project.id,
        name,
        bauabschnitt,
        filePath: `${fileId}.pdf`,
        fileHash: hash.digest("hex"),
        uploadedBy: request.user.sub,
      });
      return reply.status(201).send(plan);
    }
  );

  server.get<{ Params: { id: string } }>(
    "/api/projects/:id/plans",
    async (request, reply) => {
      const project = getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      if (!requireProjectAccess(request, reply, project.id)) return;
      return listPlansByProject(project.id);
    }
  );

  server.patch<{ Params: { id: string }; Body: { folderId?: string | null } }>(
    "/api/plans/:id",
    async (request, reply) => {
      const plan = getPlanById(request.params.id);
      if (!plan) {
        return reply.status(404).send({ error: "Plan nicht gefunden" });
      }
      if (!requireProjectAccess(request, reply, plan.project_id)) return;
      if (!hasRole(request, ["mitarbeiter", "admin"])) {
        return reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
      }
      if (!("folderId" in request.body)) {
        return reply.status(400).send({ error: "folderId ist erforderlich" });
      }
      return updatePlanFolder(plan.id, request.body.folderId ?? null);
    }
  );

  server.get<{ Params: { id: string } }>(
    "/api/plans/:id/file",
    async (request, reply) => {
      const plan = getPlanById(request.params.id);
      if (!plan) {
        server.log.warn(`Plan-Datei angefragt, aber Plan ${request.params.id} existiert nicht`);
        return reply.status(404).send({ error: "Plan nicht gefunden" });
      }
      if (!plan.file_path) {
        server.log.warn(`Plan ${plan.id} hat keinen file_path in der Datenbank`);
        return reply.status(404).send({ error: "Für diesen Plan ist keine Datei hinterlegt" });
      }
      if (!requireProjectAccess(request, reply, plan.project_id)) return;
      const absolutePath = path.join(UPLOADS_DIR, plan.file_path);
      if (!existsSync(absolutePath)) {
        server.log.error(`Plan ${plan.id}: Datenbank verweist auf ${absolutePath}, Datei fehlt auf der Platte`);
        return reply.status(404).send({ error: "Datei auf dem Server nicht (mehr) vorhanden" });
      }
      reply.header("Content-Type", "application/pdf");
      return reply.send(createReadStream(absolutePath));
    }
  );
}
