import type { FastifyInstance } from "fastify";
import { listProjects, listProjectsForUser } from "../repositories/projectRepository.js";
import { listPointsByProject, summarizePointStats } from "../repositories/pointRepository.js";
import { scopedAssignedTo } from "../authorization.js";

export async function statsRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  server.get("/api/projects/stats", async (request) => {
    const projects =
      request.user.role === "admin"
        ? await listProjects()
        : await listProjectsForUser(request.user.sub);

    // Die Abfragen werden gebuendelt abgeschickt. Wie viele davon tatsaechlich
    // gleichzeitig laufen, bestimmt die Poolgroesse in db/connection.ts (derzeit 1,
    // passend zum Serverless-Betrieb) - der Code bleibt so aber unveraendert
    // richtig, falls der Pool spaeter vergroessert wird.
    return Promise.all(
      projects.map(async (project) => {
        const points = await listPointsByProject(project.id, {
          assignedTo: scopedAssignedTo(request),
        });
        return summarizePointStats(project.id, points);
      })
    );
  });
}
