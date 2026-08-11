import type { FastifyInstance } from "fastify";
import { getProjectById } from "../repositories/projectRepository.js";
import {
  createFolder,
  deleteFolder,
  folderHasChildren,
  getFolderById,
  listFoldersByProject,
  moveFolder,
  renameFolder,
} from "../repositories/planFolderRepository.js";
import { hasRole, requireProjectAccess } from "../authorization.js";

export async function planFolderRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  server.get<{ Params: { id: string } }>(
    "/api/projects/:id/plan-folders",
    async (request, reply) => {
      const project = getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      if (!requireProjectAccess(request, reply, project.id)) return;
      return listFoldersByProject(project.id);
    }
  );

  server.post<{
    Params: { id: string };
    Body: { name: string; parentFolderId?: string | null };
  }>("/api/projects/:id/plan-folders", async (request, reply) => {
    const project = getProjectById(request.params.id);
    if (!project) {
      return reply.status(404).send({ error: "Projekt nicht gefunden" });
    }
    if (!requireProjectAccess(request, reply, project.id)) return;
    if (!hasRole(request, ["mitarbeiter", "admin"])) {
      return reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
    }
    const { name, parentFolderId } = request.body;
    if (!name) {
      return reply.status(400).send({ error: "name ist erforderlich" });
    }
    const folder = createFolder({
      projectId: project.id,
      parentFolderId: parentFolderId ?? null,
      name,
      createdBy: request.user.sub,
    });
    return reply.status(201).send(folder);
  });

  server.patch<{
    Params: { id: string };
    Body: { name?: string; parentFolderId?: string | null };
  }>("/api/plan-folders/:id", async (request, reply) => {
    const folder = getFolderById(request.params.id);
    if (!folder) {
      return reply.status(404).send({ error: "Ordner nicht gefunden" });
    }
    if (!requireProjectAccess(request, reply, folder.project_id)) return;
    if (!hasRole(request, ["mitarbeiter", "admin"])) {
      return reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
    }
    let updated = folder;
    if (typeof request.body.name === "string" && request.body.name) {
      updated = renameFolder(folder.id, request.body.name)!;
    }
    if ("parentFolderId" in request.body) {
      updated = moveFolder(folder.id, request.body.parentFolderId ?? null)!;
    }
    return updated;
  });

  server.delete<{ Params: { id: string } }>(
    "/api/plan-folders/:id",
    async (request, reply) => {
      const folder = getFolderById(request.params.id);
      if (!folder) {
        return reply.status(404).send({ error: "Ordner nicht gefunden" });
      }
      if (!requireProjectAccess(request, reply, folder.project_id)) return;
      if (!hasRole(request, ["mitarbeiter", "admin"])) {
        return reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
      }
      if (folderHasChildren(folder.id)) {
        return reply
          .status(409)
          .send({ error: "Ordner ist nicht leer - erst Unterordner/Pläne verschieben oder löschen" });
      }
      deleteFolder(folder.id);
      return reply.status(204).send();
    }
  );
}
