import type { FastifyInstance } from "fastify";
import { getProjectById } from "../repositories/projectRepository.js";
import { getPlanById } from "../repositories/planRepository.js";
import {
  createPoint,
  getPointById,
  softDeletePoint,
  updatePoint,
} from "../repositories/pointRepository.js";
import {
  getAffectedPointIdsSince,
  getLatestSeq,
  recordChange,
} from "../repositories/changeLogRepository.js";
import { hasRole, requireProjectAccess, requireProjectWritable } from "../authorization.js";

interface SyncChange {
  localId: string;
  op: "create" | "update" | "delete";
  point: {
    id: string;
    planId: string;
    x?: number;
    y?: number;
    pageNumber?: number;
    pointType?: string;
    categoryId?: string;
    customFields?: Record<string, string | number | boolean>;
    title?: string;
    description?: string;
    bauabschnitt?: string;
    priority?: string;
    assignedTo?: string;
    dueDate?: string;
    gewerk?: string;
    raumBereich?: string;
    version?: number;
  };
}

export async function syncRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  server.get<{ Params: { projectId: string }; Querystring: { since?: string } }>(
    "/api/sync/:projectId/changes",
    async (request, reply) => {
      const project = await getProjectById(request.params.projectId);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      if (!(await requireProjectAccess(request, reply, project.id))) return;
      const since = Number(request.query.since ?? 0);
      const affectedIds = await getAffectedPointIdsSince(project.id, since);
      const loaded = await Promise.all(affectedIds.map((id) => getPointById(id)));
      let points = loaded.filter((p): p is NonNullable<typeof p> => Boolean(p));
      if (request.user.role === "extern") {
        points = points.filter((p) => p.assigned_to === request.user.sub);
      }
      return { points, newCursor: await getLatestSeq(project.id) };
    }
  );

  server.post<{ Params: { projectId: string }; Body: { changes: SyncChange[] } }>(
    "/api/sync/:projectId/push",
    async (request, reply) => {
      const project = await getProjectById(request.params.projectId);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      if (!(await requireProjectWritable(request, reply, project.id))) return;
      if (!hasRole(request, ["mitarbeiter", "admin"])) {
        return reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
      }

      const results: Array<{
        localId: string;
        status: "applied" | "conflict" | "error";
        point?: unknown;
        error?: string;
      }> = [];

      for (const change of request.body.changes ?? []) {
        try {
          const plan = await getPlanById(change.point.planId);
          if (!plan) {
            results.push({ localId: change.localId, status: "error", error: "Plan nicht gefunden" });
            continue;
          }

          if (change.op === "create") {
            const existing = await getPointById(change.point.id);
            if (existing) {
              results.push({ localId: change.localId, status: "applied", point: existing });
              continue;
            }
            if (!change.point.title || change.point.x === undefined || change.point.y === undefined) {
              results.push({ localId: change.localId, status: "error", error: "Unvollständige Punktdaten" });
              continue;
            }
            const point = await createPoint({
              id: change.point.id,
              planId: change.point.planId,
              x: change.point.x,
              y: change.point.y,
              pageNumber: change.point.pageNumber,
              pointType: change.point.pointType,
              categoryId: change.point.categoryId,
              customFields: change.point.customFields
                ? JSON.stringify(change.point.customFields)
                : undefined,
              title: change.point.title,
              description: change.point.description,
              bauabschnitt: change.point.bauabschnitt,
              priority: change.point.priority,
              assignedTo: change.point.assignedTo,
              dueDate: change.point.dueDate,
              gewerk: change.point.gewerk,
              raumBereich: change.point.raumBereich,
              createdBy: request.user.sub,
            });
            await recordChange({
              entityType: "point",
              entityId: point.id,
              projectId: plan.project_id,
              op: "create",
            });
            results.push({ localId: change.localId, status: "applied", point });
          } else if (change.op === "update") {
            const updateResult = await updatePoint(change.point.id, {
              title: change.point.title,
              description: change.point.description,
              pointType: change.point.pointType,
              categoryId: change.point.categoryId,
              customFields: change.point.customFields
                ? JSON.stringify(change.point.customFields)
                : undefined,
              bauabschnitt: change.point.bauabschnitt,
              priority: change.point.priority,
              assignedTo: change.point.assignedTo,
              dueDate: change.point.dueDate,
              gewerk: change.point.gewerk,
              raumBereich: change.point.raumBereich,
              x: change.point.x,
              y: change.point.y,
              updatedBy: request.user.sub,
              expectedVersion: change.point.version,
              source: "offline-sync",
            });
            if (!updateResult) {
              results.push({ localId: change.localId, status: "error", error: "Punkt nicht gefunden" });
              continue;
            }
            await recordChange({
              entityType: "point",
              entityId: updateResult.point.id,
              projectId: plan.project_id,
              op: "update",
            });
            results.push({
              localId: change.localId,
              status: updateResult.conflict ? "conflict" : "applied",
              point: updateResult.point,
            });
          } else if (change.op === "delete") {
            const existing = await getPointById(change.point.id);
            const deleted = await softDeletePoint(change.point.id);
            if (!deleted || !existing) {
              results.push({ localId: change.localId, status: "error", error: "Punkt nicht gefunden" });
              continue;
            }
            await recordChange({
              entityType: "point",
              entityId: existing.id,
              projectId: plan.project_id,
              op: "delete",
            });
            results.push({ localId: change.localId, status: "applied" });
          }
        } catch (err) {
          results.push({ localId: change.localId, status: "error", error: String(err) });
        }
      }

      return { results, newCursor: await getLatestSeq(project.id) };
    }
  );
}
