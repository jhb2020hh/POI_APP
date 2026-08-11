import type { FastifyInstance } from "fastify";
import { listProjects, listProjectsForUser } from "../repositories/projectRepository.js";
import { listPointsByProject, summarizePointStats } from "../repositories/pointRepository.js";
import { scopedAssignedTo } from "../authorization.js";

export async function statsRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  server.get("/api/projects/stats", async (request) => {
    const projects =
      request.user.role === "admin"
        ? listProjects()
        : listProjectsForUser(request.user.sub);

    return projects.map((project) => {
      const points = listPointsByProject(project.id, {
        assignedTo: scopedAssignedTo(request),
      });
      return summarizePointStats(project.id, points);
    });
  });
}
