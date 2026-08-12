import type { FastifyInstance } from "fastify";
import { getProjectById } from "../repositories/projectRepository.js";
import {
  archiveExportTemplate,
  createExportTemplate,
  getExportTemplateById,
  listExportTemplatesForProject,
  updateExportTemplate,
} from "../repositories/exportTemplateRepository.js";
import { hasRole, requireProjectAccess, requireProjectWritable } from "../authorization.js";

/** Grenze gegen versehentlich riesige Vorlagen; 60 Spalten sind reichlich. */
const MAX_SPALTEN = 60;

function pruefeSpalten(spalten: unknown): string[] | null {
  if (!Array.isArray(spalten)) return null;
  if (spalten.length === 0 || spalten.length > MAX_SPALTEN) return null;
  if (!spalten.every((s) => typeof s === "string" && s.length > 0 && s.length <= 120)) {
    return null;
  }
  // Doppelte Spalten sind kein Fehler des Nutzers, sondern ein Versehen beim
  // Zusammenklicken - sie werden still entfernt statt abgewiesen.
  return [...new Set(spalten as string[])];
}

export async function exportTemplateRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  server.get<{ Params: { id: string } }>(
    "/api/projects/:id/export-templates",
    async (request, reply) => {
      const project = await getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      if (!(await requireProjectAccess(request, reply, project.id))) return;
      return listExportTemplatesForProject(project.id);
    }
  );

  server.post<{
    Params: { id: string };
    Body: { name?: string; columns?: unknown; global?: boolean };
  }>("/api/projects/:id/export-templates", async (request, reply) => {
    const project = await getProjectById(request.params.id);
    if (!project) {
      return reply.status(404).send({ error: "Projekt nicht gefunden" });
    }
    if (!(await requireProjectWritable(request, reply, project.id))) return;
    if (!hasRole(request, ["mitarbeiter", "admin"])) {
      return reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
    }

    const name = request.body?.name?.trim();
    if (!name) {
      return reply.status(400).send({ error: "Ein Name ist erforderlich" });
    }
    const spalten = pruefeSpalten(request.body?.columns);
    if (!spalten) {
      return reply
        .status(400)
        .send({ error: `Es muss mindestens eine und dürfen höchstens ${MAX_SPALTEN} Spalten sein` });
    }
    // Projektuebergreifend anlegen duerfen nur Admins - eine solche Vorlage
    // taucht in jedem Projekt auf.
    const global = request.body?.global === true;
    if (global && !hasRole(request, ["admin"])) {
      return reply
        .status(403)
        .send({ error: "Projektübergreifende Vorlagen dürfen nur Administratoren anlegen" });
    }

    const vorlage = await createExportTemplate({
      projectId: global ? null : project.id,
      name,
      columns: spalten,
      createdBy: request.user.sub,
    });
    return reply.status(201).send(vorlage);
  });

  /**
   * Aendern und Entfernen pruefen die Berechtigung nach dem Nachschlagen, weil
   * sie davon abhaengt, ob die Vorlage projektgebunden oder uebergreifend ist -
   * dieselbe Regel wie bei den Ticketvorlagen.
   */
  async function darfBearbeiten(
    request: Parameters<typeof requireProjectAccess>[0],
    reply: Parameters<typeof requireProjectAccess>[1],
    vorlageProjektId: string | null
  ): Promise<boolean> {
    if (vorlageProjektId === null) {
      if (!hasRole(request, ["admin"])) {
        reply
          .status(403)
          .send({ error: "Projektübergreifende Vorlagen dürfen nur Administratoren ändern" });
        return false;
      }
      return true;
    }
    if (!(await requireProjectWritable(request, reply, vorlageProjektId))) return false;
    if (!hasRole(request, ["mitarbeiter", "admin"])) {
      reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
      return false;
    }
    return true;
  }

  server.patch<{
    Params: { templateId: string };
    Body: { name?: string; columns?: unknown };
  }>("/api/export-templates/:templateId", async (request, reply) => {
    const vorlage = await getExportTemplateById(request.params.templateId);
    if (!vorlage) {
      return reply.status(404).send({ error: "Vorlage nicht gefunden" });
    }
    if (!(await darfBearbeiten(request, reply, vorlage.project_id))) return;

    const name = request.body?.name?.trim();
    if (request.body?.name !== undefined && !name) {
      return reply.status(400).send({ error: "Der Name darf nicht leer sein" });
    }
    let spalten: string[] | undefined;
    if (request.body?.columns !== undefined) {
      const geprueft = pruefeSpalten(request.body.columns);
      if (!geprueft) {
        return reply
          .status(400)
          .send({ error: `Es muss mindestens eine und dürfen höchstens ${MAX_SPALTEN} Spalten sein` });
      }
      spalten = geprueft;
    }

    const geaendert = await updateExportTemplate(vorlage.id, { name, columns: spalten });
    if (!geaendert) {
      return reply.status(404).send({ error: "Vorlage nicht gefunden" });
    }
    return geaendert;
  });

  server.delete<{ Params: { templateId: string } }>(
    "/api/export-templates/:templateId",
    async (request, reply) => {
      const vorlage = await getExportTemplateById(request.params.templateId);
      if (!vorlage) {
        return reply.status(404).send({ error: "Vorlage nicht gefunden" });
      }
      if (!(await darfBearbeiten(request, reply, vorlage.project_id))) return;
      await archiveExportTemplate(vorlage.id);
      return reply.status(204).send();
    }
  );
}
