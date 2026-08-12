import type { FastifyInstance } from "fastify";
import {
  archiveProject,
  collectProjectFilePaths,
  createProject,
  deleteProjectCompletely,
  findProjectByNumber,
  getProjectById,
  listArchivedProjects,
  listProjects,
  listProjectsForUser,
  unarchiveProject,
  updateProjectDates,
} from "../repositories/projectRepository.js";
import { addMember } from "../repositories/projectMemberRepository.js";
import { ATTACHMENTS_BUCKET, PLANS_BUCKET, supabaseAdmin } from "../supabase.js";
import {
  requireProjectAccess,
  requireProjectWritable,
  requireRole,
} from "../authorization.js";

export async function projectRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  server.post<{
    Body: {
      name: string;
      description?: string;
      projectNumber?: string;
      address?: string;
      customer?: string;
      status?: string;
      projectLead?: string;
    };
  }>(
    "/api/projects",
    { preHandler: requireRole(["mitarbeiter", "admin"]) },
    async (request, reply) => {
      const {
        name,
        description,
        projectNumber,
        address,
        customer,
        status,
        projectLead,
      } = request.body;
      if (!name) {
        return reply.status(400).send({ error: "name ist erforderlich" });
      }
      if (!projectNumber?.trim()) {
        return reply.status(400).send({ error: "Projektnummer ist erforderlich" });
      }
      if (await findProjectByNumber(projectNumber.trim())) {
        return reply.status(409).send({ error: "Projektnummer wird bereits verwendet" });
      }
      const project = await createProject({
        name,
        description,
        createdBy: request.user.sub,
        projectNumber,
        address,
        customer,
        status,
        projectLead,
      });
      await addMember(project.id, request.user.sub);
      return reply.status(201).send(project);
    }
  );

  server.get("/api/projects", async (request) => {
    if (request.user.role === "admin") {
      return listProjects();
    }
    return listProjectsForUser(request.user.sub);
  });

  server.get<{ Params: { id: string } }>(
    "/api/projects/:id",
    async (request, reply) => {
      const project = await getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      if (!(await requireProjectAccess(request, reply, project.id))) return;
      return project;
    }
  );

  server.patch<{
    Params: { id: string };
    Body: { baubeginn?: string | null; fertigstellung?: string | null };
  }>(
    "/api/projects/:id",
    { preHandler: requireRole(["mitarbeiter", "admin"]) },
    async (request, reply) => {
      const project = await getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      if (!(await requireProjectWritable(request, reply, project.id))) return;
      return updateProjectDates(project.id, request.body);
    }
  );

  // ===========================================================================
  // Archiv
  // ===========================================================================
  // Archivieren und Loeschen waren bis hierher dasselbe: DELETE setzte nur
  // archived = 1, und archivierte Projekte waren nirgends mehr sichtbar. Beides
  // ist jetzt getrennt - archivieren ist umkehrbar, loeschen nicht.

  server.get(
    "/api/projects/archived",
    { preHandler: requireRole(["admin"]) },
    async () => {
      return listArchivedProjects();
    }
  );

  server.post<{ Params: { id: string } }>(
    "/api/projects/:id/archive",
    { preHandler: requireRole(["admin"]) },
    async (request, reply) => {
      const project = await getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      await archiveProject(project.id);
      return reply.status(204).send();
    }
  );

  server.post<{ Params: { id: string } }>(
    "/api/projects/:id/unarchive",
    { preHandler: requireRole(["admin"]) },
    async (request, reply) => {
      const project = await getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      await unarchiveProject(project.id);
      return reply.status(204).send();
    }
  );

  /**
   * Loescht ein Projekt endgueltig - Datenbankzeilen und Dateien.
   *
   * Zwei Sicherungen: nur Admins, und nur aus dem Archiv heraus. Der Umweg ueber
   * das Archiv ist Absicht - er trennt den Moment der Entscheidung ("das Projekt
   * ist fertig") vom Moment des Loeschens, und dazwischen liegt so lange, wie
   * jemand will.
   *
   * Reihenfolge: erst die Dateipfade sammeln, dann die Zeilen in einer
   * Transaktion loeschen, danach die Dateien. Bricht es beim Loeschen der
   * Dateien ab, bleibt eine verwaiste Datei liegen - aergerlich, aber
   * harmlos. Andersherum haette man Zeilen, die auf nicht mehr vorhandene
   * Dateien zeigen: ein Ticket mit einem Foto, das sich nicht mehr oeffnen
   * laesst.
   */
  server.delete<{ Params: { id: string } }>(
    "/api/projects/:id",
    { preHandler: requireRole(["admin"]) },
    async (request, reply) => {
      const project = await getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      if (!project.archived) {
        return reply.status(409).send({
          error:
            "Nur archivierte Projekte können endgültig gelöscht werden. " +
            "Bitte das Projekt zuerst archivieren.",
          code: "NICHT_ARCHIVIERT",
        });
      }

      const pfade = await collectProjectFilePaths(project.id);

      try {
        await deleteProjectCompletely(project.id);
      } catch (error) {
        server.log.error({ error, projectId: project.id }, "Projekt konnte nicht gelöscht werden");
        return reply.status(502).send({ error: "Projekt konnte nicht gelöscht werden" });
      }

      // Ab hier ist das Projekt weg. Scheitert das Aufraeumen der Dateien,
      // wird das protokolliert, aber nicht als Fehler gemeldet - der Aufrufer
      // koennte ohnehin nichts mehr tun, und ein Fehlschlag hier hiesse sonst
      // faelschlich "loeschen fehlgeschlagen".
      const uebrig: string[] = [];
      for (const [bucket, dateien] of [
        [PLANS_BUCKET, pfade.plans],
        [ATTACHMENTS_BUCKET, pfade.attachments],
      ] as const) {
        if (dateien.length === 0) continue;
        const { error } = await supabaseAdmin.storage.from(bucket).remove(dateien);
        if (error) {
          uebrig.push(`${bucket}: ${dateien.length}`);
          server.log.error({ error, bucket }, "Dateien konnten nicht entfernt werden");
        }
      }
      if (uebrig.length > 0) {
        server.log.warn(
          { uebrig },
          "Projekt geloescht, aber Dateien blieben in der Ablage zurueck"
        );
      }

      return reply.status(204).send();
    }
  );
}
