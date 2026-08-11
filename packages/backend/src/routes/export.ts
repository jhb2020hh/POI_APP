import type { FastifyInstance } from "fastify";
import { getProjectById } from "../repositories/projectRepository.js";
import { listPointsByProject } from "../repositories/pointRepository.js";
import { listCategoriesForProject } from "../repositories/categoryRepository.js";
import { listUsers } from "../repositories/userRepository.js";
import { requireProjectAccess, scopedAssignedTo } from "../authorization.js";

function csvEscape(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function exportRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  server.get<{
    Params: { id: string };
    Querystring: {
      planId?: string;
      status?: string;
      bauabschnitt?: string;
      from?: string;
      to?: string;
      assignedTo?: string;
    };
  }>("/api/projects/:id/points/export.csv", async (request, reply) => {
    const project = getProjectById(request.params.id);
    if (!project) {
      return reply.status(404).send({ error: "Projekt nicht gefunden" });
    }
    if (!requireProjectAccess(request, reply, project.id)) return;

    const points = listPointsByProject(project.id, {
      ...request.query,
      assignedTo: scopedAssignedTo(request, request.query.assignedTo),
    });
    const categories = listCategoriesForProject(project.id);
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const users = listUsers();
    const userById = new Map(users.map((u) => [u.id, u]));

    const header = [
      "Ticket-Nr.",
      "Titel",
      "Kategorie",
      "Status",
      "Prioritaet",
      "Zustaendig",
      "Faellig",
      "Gewerk",
      "Raum/Bereich",
      "Bauabschnitt",
      "Erstellt am",
      "Beschreibung",
    ];
    const rows = points.map((p) => [
      p.ticket_number ?? "",
      p.title,
      p.category_id ? categoryById.get(p.category_id)?.name ?? "" : "",
      p.status,
      p.priority ?? "",
      p.assigned_to ? userById.get(p.assigned_to)?.display_name ?? "" : "",
      p.due_date ?? "",
      p.gewerk ?? "",
      p.raum_bereich ?? "",
      p.bauabschnitt ?? "",
      p.created_at,
      p.description ?? "",
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map(csvEscape).join(","))
      .join("\r\n");
    const bom = "﻿";

    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="tickets-${project.id}.csv"`
      )
      .send(bom + csv);
  });
}
