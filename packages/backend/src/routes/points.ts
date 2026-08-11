import type { FastifyInstance } from "fastify";
import { getPlanById, listPlansByProject } from "../repositories/planRepository.js";
import { getProjectById } from "../repositories/projectRepository.js";
import {
  createPoint,
  getPointById,
  listPointsByPlan,
  listPointsByProject,
  softDeletePoint,
  updatePoint,
} from "../repositories/pointRepository.js";
import { recordChange } from "../repositories/changeLogRepository.js";
import { hasRole, requireProjectAccess, scopedAssignedTo } from "../authorization.js";

// Hinweis: Es wird hier nichts mehr aktiv an andere Clients gesendet. Die
// Live-Aktualisierung laeuft ueber Supabase Realtime, das Aenderungen an der
// Tabelle `points` direkt aus dem Transaktionslog an die berechtigten Clients
// verteilt (siehe Migration 0020 und packages/frontend/src/api/socket.ts).

export async function pointRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  server.get<{
    Querystring: {
      planId?: string;
      bauabschnitt?: string;
      from?: string;
      to?: string;
      status?: string;
      assignedTo?: string;
    };
  }>("/api/points", async (request, reply) => {
    const { planId, bauabschnitt, from, to, status, assignedTo } = request.query;
    if (!planId) {
      return reply.status(400).send({ error: "planId ist erforderlich" });
    }
    const plan = await getPlanById(planId);
    if (!plan) {
      return reply.status(404).send({ error: "Plan nicht gefunden" });
    }
    if (!(await requireProjectAccess(request, reply, plan.project_id))) return;
    return listPointsByPlan(planId, {
      bauabschnitt,
      from,
      to,
      status,
      assignedTo: scopedAssignedTo(request, assignedTo),
    });
  });

  server.get<{
    Params: { id: string };
    Querystring: {
      planId?: string;
      bauabschnitt?: string;
      from?: string;
      to?: string;
      status?: string;
      assignedTo?: string;
      gewerk?: string;
      categoryId?: string;
    };
  }>("/api/projects/:id/points", async (request, reply) => {
    const project = await getProjectById(request.params.id);
    if (!project) {
      return reply.status(404).send({ error: "Projekt nicht gefunden" });
    }
    if (!(await requireProjectAccess(request, reply, project.id))) return;

    const { planId, bauabschnitt, from, to, status, assignedTo, gewerk, categoryId } = request.query;
    const points = await listPointsByProject(project.id, {
      planId,
      bauabschnitt,
      from,
      to,
      status,
      assignedTo: scopedAssignedTo(request, assignedTo),
      gewerk,
      categoryId,
    });
    const plans = await listPlansByProject(project.id);
    const planNameById = new Map(plans.map((p) => [p.id, p.name]));
    return points.map((point) => ({
      ...point,
      plan_name: planNameById.get(point.plan_id) ?? null,
    }));
  });

  server.post<{
    Body: {
      id: string;
      planId: string;
      x: number;
      y: number;
      pageNumber?: number;
      pointType?: string;
      categoryId?: string;
      customFields?: Record<string, string | number | boolean>;
      title: string;
      description?: string;
      bauabschnitt?: string;
      priority?: string;
      assignedTo?: string;
      dueDate?: string;
      gewerk?: string;
      raumBereich?: string;
    };
  }>("/api/points", async (request, reply) => {
    const {
      id,
      planId,
      x,
      y,
      pageNumber,
      pointType,
      categoryId,
      customFields,
      title,
      description,
      bauabschnitt,
      priority,
      assignedTo,
      dueDate,
      gewerk,
      raumBereich,
    } = request.body;
    if (!id || !planId || x === undefined || y === undefined || !title) {
      return reply
        .status(400)
        .send({ error: "id, planId, x, y und title sind erforderlich" });
    }
    const plan = await getPlanById(planId);
    if (!plan) {
      return reply.status(404).send({ error: "Plan nicht gefunden" });
    }
    if (!(await requireProjectAccess(request, reply, plan.project_id))) return;
    if (!hasRole(request, ["mitarbeiter", "admin"])) {
      return reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
    }
    const point = await createPoint({
      id,
      planId,
      x,
      y,
      pageNumber,
      pointType,
      categoryId,
      customFields: customFields ? JSON.stringify(customFields) : undefined,
      title,
      description,
      bauabschnitt,
      priority,
      assignedTo,
      dueDate,
      gewerk,
      raumBereich,
      createdBy: request.user.sub,
    });
    await recordChange({
      entityType: "point",
      entityId: point.id,
      projectId: plan.project_id,
      op: "create",
    });
    return reply.status(201).send(point);
  });

  server.put<{
    Params: { id: string };
    Body: {
      title?: string;
      description?: string;
      pointType?: string;
      categoryId?: string;
      customFields?: Record<string, string | number | boolean>;
      status?: string;
      bauabschnitt?: string;
      priority?: string;
      assignedTo?: string;
      dueDate?: string;
      gewerk?: string;
      raumBereich?: string;
      x?: number;
      y?: number;
      version?: number;
    };
  }>("/api/points/:id", async (request, reply) => {
    const existing = await getPointById(request.params.id);
    if (!existing) {
      return reply.status(404).send({ error: "Punkt nicht gefunden" });
    }
    const plan = await getPlanById(existing.plan_id);
    if (plan) {
      if (!(await requireProjectAccess(request, reply, plan.project_id))) return;
    }
    if (!hasRole(request, ["mitarbeiter", "admin"])) {
      return reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
    }

    const { version, customFields, ...fields } = request.body;
    const result = await updatePoint(request.params.id, {
      ...fields,
      customFields: customFields ? JSON.stringify(customFields) : undefined,
      updatedBy: request.user.sub,
      expectedVersion: version,
    });
    if (!result) {
      return reply.status(404).send({ error: "Punkt nicht gefunden" });
    }
    const { point, conflict, previousValue } = result;
    if (plan) {
      await recordChange({
        entityType: "point",
        entityId: point.id,
        projectId: plan.project_id,
        op: "update",
      });
    }
    return { ...point, conflict, previousValue: conflict ? previousValue : undefined };
  });

  server.delete<{ Params: { id: string } }>(
    "/api/points/:id",
    async (request, reply) => {
      const existing = await getPointById(request.params.id);
      if (!existing) {
        return reply.status(404).send({ error: "Punkt nicht gefunden" });
      }
      const plan = await getPlanById(existing.plan_id);
      if (plan) {
        if (!(await requireProjectAccess(request, reply, plan.project_id))) return;
      }
      if (!hasRole(request, ["mitarbeiter", "admin"])) {
        return reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
      }

      const deleted = await softDeletePoint(request.params.id);
      if (!deleted) {
        return reply.status(404).send({ error: "Punkt nicht gefunden" });
      }
      if (plan) {
        await recordChange({
          entityType: "point",
          entityId: existing.id,
          projectId: plan.project_id,
          op: "delete",
        });
      }
      return reply.status(204).send();
    }
  );
}
