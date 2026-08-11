import type { FastifyInstance } from "fastify";
import { getProjectById } from "../repositories/projectRepository.js";
import { listPlansByProject } from "../repositories/planRepository.js";
import { listPointsByPlan } from "../repositories/pointRepository.js";
import type { Point } from "../repositories/pointRepository.js";
import { getLatestSeq } from "../repositories/changeLogRepository.js";
import { requireProjectAccess } from "../authorization.js";

export async function offlineRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  server.get<{ Params: { id: string } }>(
    "/api/projects/:id/offline-bundle",
    async (request, reply) => {
      const project = await getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      if (!(await requireProjectAccess(request, reply, project.id))) return;
      const plans = await listPlansByProject(project.id);
      const pointsByPlan: Record<string, Point[]> = {};
      for (const plan of plans) {
        const points = await listPointsByPlan(plan.id);
        pointsByPlan[plan.id] =
          request.user.role === "extern"
            ? points.filter((p) => p.assigned_to === request.user.sub)
            : points;
      }
      return {
        project,
        plans,
        pointsByPlan,
        syncCursor: await getLatestSeq(project.id),
      };
    }
  );
}
