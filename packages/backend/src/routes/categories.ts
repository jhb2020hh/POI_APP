import type { FastifyInstance } from "fastify";
import { getProjectById } from "../repositories/projectRepository.js";
import {
  archiveCategory,
  createCategory,
  getCategoryById,
  listArchivedGlobalCategories,
  listCategoriesForProject,
  listGlobalCategories,
  listUsedFieldDefs,
  unarchiveCategory,
  updateCategory,
} from "../repositories/categoryRepository.js";
import { hasRole, requireProjectAccess, requireProjectWritable, requireRole } from "../authorization.js";

export async function categoryRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  server.get<{ Params: { id: string } }>(
    "/api/projects/:id/categories",
    async (request, reply) => {
      const project = await getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      if (!(await requireProjectAccess(request, reply, project.id))) return;
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
    const project = await getProjectById(request.params.id);
    if (!project) {
      return reply.status(404).send({ error: "Projekt nicht gefunden" });
    }
    if (!(await requireProjectWritable(request, reply, project.id))) return;
    if (!hasRole(request, ["mitarbeiter", "admin"])) {
      return reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
    }
    const { name, color, glyph, shortCode, fieldSchemaJson } = request.body;
    if (!name) {
      return reply.status(400).send({ error: "name ist erforderlich" });
    }
    const category = await createCategory({
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
    const category = await createCategory({
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

  /**
   * Aendert eine Vorlage - projektgebunden oder zentral.
   *
   * Die Berechtigung haengt daran, um welche Art es sich handelt, und richtet
   * sich nach denselben Regeln wie das Anlegen: zentrale Vorlagen nur fuer
   * Admins, projekteigene fuer Mitarbeiter des jeweiligen Projekts. Deshalb
   * kein preHandler, sondern eine Pruefung nach dem Nachschlagen.
   *
   * shortCode fehlt absichtlich: siehe updateCategory.
   */
  server.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      color?: string;
      glyph?: string;
      fieldSchemaJson?: string;
    };
  }>("/api/categories/:id", async (request, reply) => {
    const bestehend = await getCategoryById(request.params.id);
    if (!bestehend) {
      return reply.status(404).send({ error: "Vorlage nicht gefunden" });
    }

    if (bestehend.project_id === null) {
      if (!hasRole(request, ["admin"])) {
        return reply
          .status(403)
          .send({ error: "Zentrale Vorlagen dürfen nur Administratoren ändern" });
      }
    } else {
      if (!(await requireProjectWritable(request, reply, bestehend.project_id))) return;
      if (!hasRole(request, ["mitarbeiter", "admin"])) {
        return reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
      }
    }

    const { name, color, glyph, fieldSchemaJson } = request.body;
    if (name !== undefined && !name.trim()) {
      return reply.status(400).send({ error: "name darf nicht leer sein" });
    }
    if (fieldSchemaJson !== undefined) {
      try {
        JSON.parse(fieldSchemaJson);
      } catch {
        return reply.status(400).send({ error: "fieldSchemaJson ist kein gültiges JSON" });
      }
    }

    const geaendert = await updateCategory(bestehend.id, {
      name: name?.trim(),
      color,
      glyph,
      fieldSchemaJson,
    });
    if (!geaendert) {
      return reply.status(404).send({ error: "Vorlage nicht gefunden" });
    }
    return geaendert;
  });

  server.delete<{ Params: { id: string } }>(
    "/api/categories/:id",
    { preHandler: requireRole(["admin"]) },
    async (request, reply) => {
      const archived = await archiveCategory(request.params.id);
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
      const restored = await unarchiveCategory(request.params.id);
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
