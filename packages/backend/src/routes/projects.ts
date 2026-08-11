import type { FastifyInstance } from "fastify";
import {
  archiveProject,
  createProject,
  findProjectByNumber,
  getProjectById,
  listProjects,
  listProjectsForUser,
  updateProjectDates,
} from "../repositories/projectRepository.js";
import { addMember } from "../repositories/projectMemberRepository.js";
import { requireProjectAccess, requireRole } from "../authorization.js";

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
      if (findProjectByNumber(projectNumber.trim())) {
        return reply.status(409).send({ error: "Projektnummer wird bereits verwendet" });
      }
      const project = createProject({
        name,
        description,
        createdBy: request.user.sub,
        projectNumber,
        address,
        customer,
        status,
        projectLead,
      });
      addMember(project.id, request.user.sub);
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
      const project = getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      if (!requireProjectAccess(request, reply, project.id)) return;
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
      const project = getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      if (!requireProjectAccess(request, reply, project.id)) return;
      return updateProjectDates(project.id, request.body);
    }
  );

  server.delete<{ Params: { id: string } }>(
    "/api/projects/:id",
    { preHandler: requireRole(["admin"]) },
    async (request, reply) => {
      const project = getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      archiveProject(project.id);
      return reply.status(204).send();
    }
  );
}
