import type { FastifyInstance } from "fastify";
import { getPointById } from "../repositories/pointRepository.js";
import { getPlanById } from "../repositories/planRepository.js";
import { listHistoryForPoint } from "../repositories/pointHistoryRepository.js";
import {
  createComment,
  listCommentsForPoint,
} from "../repositories/pointCommentRepository.js";
import { hasRole, requireProjectAccess } from "../authorization.js";

export async function pointDetailRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  server.get<{ Params: { id: string } }>(
    "/api/points/:id/history",
    async (request, reply) => {
      const point = getPointById(request.params.id);
      if (!point) {
        return reply.status(404).send({ error: "Punkt nicht gefunden" });
      }
      const plan = getPlanById(point.plan_id);
      if (plan) {
        if (!requireProjectAccess(request, reply, plan.project_id)) return;
      }
      if (request.user.role === "extern" && point.assigned_to !== request.user.sub) {
        return reply.status(403).send({ error: "kein Zugriff auf dieses Ticket" });
      }
      return listHistoryForPoint(point.id);
    }
  );

  server.get<{ Params: { id: string } }>(
    "/api/points/:id/comments",
    async (request, reply) => {
      const point = getPointById(request.params.id);
      if (!point) {
        return reply.status(404).send({ error: "Punkt nicht gefunden" });
      }
      const plan = getPlanById(point.plan_id);
      if (plan) {
        if (!requireProjectAccess(request, reply, plan.project_id)) return;
      }
      if (request.user.role === "extern" && point.assigned_to !== request.user.sub) {
        return reply.status(403).send({ error: "kein Zugriff auf dieses Ticket" });
      }
      return listCommentsForPoint(point.id);
    }
  );

  server.post<{ Params: { id: string }; Body: { body: string } }>(
    "/api/points/:id/comments",
    async (request, reply) => {
      const point = getPointById(request.params.id);
      if (!point) {
        return reply.status(404).send({ error: "Punkt nicht gefunden" });
      }
      const plan = getPlanById(point.plan_id);
      if (plan) {
        if (!requireProjectAccess(request, reply, plan.project_id)) return;
      }
      if (!hasRole(request, ["mitarbeiter", "admin"])) {
        return reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
      }
      if (!request.body.body) {
        return reply.status(400).send({ error: "body ist erforderlich" });
      }
      const comment = createComment({
        pointId: point.id,
        authorId: request.user.sub,
        body: request.body.body,
      });
      return reply.status(201).send(comment);
    }
  );
}
