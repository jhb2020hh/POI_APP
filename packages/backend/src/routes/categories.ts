import type { FastifyInstance } from "fastify";
import { getProjectById } from "../repositories/projectRepository.js";
import {
  archiveCategory,
  createCategory,
  listArchivedGlobalCategories,
  listCategoriesForProject,
  listGlobalCategories,
  listUsedFieldDefs,
  unarchiveCategory,
} from "../repositories/categoryRepository.js";
import { hasRole, requireProjectAccess, requireRole } from "../authorization.js";

export async function categoryRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  server.get<{ Params: { id: string } }>(
    "/api/projects/:id/categories",
    async (request, reply) => {
      const project = getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      if (!requireProjectAccess(request, reply, project.id)) return;
      return listCategoriesForProject(project.id);
    }
  );

  server.post<{
    Params: { id: string };
    Body: {
      name: string;
      color?: string;
      glyph?: string;
      shortCode?: string;
      fieldSchemaJson?: string;
    };
  }>("/api/projects/:id/categories", async (request, reply) => {
    const project = getProjectById(request.params.id);
    if (!project) {
      return reply.status(404).send({ error: "Projekt nicht gefunden" });
    }
    if (!requireProjectAccess(request, reply, project.id)) return;
    if (!hasRole(request, ["mitarbeiter", "admin"])) {
      return reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
    }
    const { name, color, glyph, shortCode, fieldSchemaJson } = request.body;
    if (!name) {
      return reply.status(400).send({ error: "name ist erforderlich" });
    }
    const category = createCategory({
      projectId: project.id,
      name,
      color,
      glyph,
      shortCode,
      fieldSchemaJson,
      createdBy: request.user.sub,
    });
    return reply.status(201).send(category);
  });

  // Zentrale (nicht projektgebundene) Ticketvorlagen - nur admin, automatisch
  // in jedem Projekt sichtbar (siehe listCategoriesForProject: project_id IS NULL).
  server.get("/api/categories", { preHandler: requireRole(["admin"]) }, async () => {
    return listGlobalCategories();
  });

  server.post<{
    Body: {
      name: string;
      color?: string;
      glyph?: string;
      shortCode?: string;
      fieldSchemaJson?: string;
    };
  }>("/api/categories", { preHandler: requireRole(["admin"]) }, async (request, reply) => {
    const { name, color, glyph, shortCode, fieldSchemaJson } = request.body;
    if (!name) {
      return reply.status(400).send({ error: "name ist erforderlich" });
    }
    const category = createCategory({
      projectId: null,
      name,
      color,
      glyph,
      shortCode,
      fieldSchemaJson,
      createdBy: request.user.sub,
    });
    return reply.status(201).send(category);
  });

  server.delete<{ Params: { id: string } }>(
    "/api/categories/:id",
    { preHandler: requireRole(["admin"]) },
    async (request, reply) => {
      const archived = archiveCategory(request.params.id);
      if (!archived) {
        return reply.status(404).send({ error: "Vorlage nicht gefunden" });
      }
      return reply.status(204).send();
    }
  );

  server.get("/api/categories/archived", { preHandler: requireRole(["admin"]) }, async () => {
    return listArchivedGlobalCategories();
  });

  server.post<{ Params: { id: string } }>(
    "/api/categories/:id/restore",
    { preHandler: requireRole(["admin"]) },
    async (request, reply) => {
      const restored = unarchiveCategory(request.params.id);
      if (!restored) {
        return reply.status(404).send({ error: "Vorlage nicht gefunden" });
      }
      return reply.status(204).send();
    }
  );

  // Feld-Vorschläge fürs Anlegen neuer Vorlagen (aus allen bestehenden Vorlagen
  // aggregiert) - fürs Fixen von Tippfehlern bereits benutzte Feld-Schlüssel/-Namen
  // wiederverwenden statt neu einzutippen.
  server.get(
    "/api/categories/field-suggestions",
    { preHandler: requireRole(["mitarbeiter", "admin"]) },
    async () => {
      return listUsedFieldDefs();
    }
  );
}
