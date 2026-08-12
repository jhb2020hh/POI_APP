import type { FastifyInstance } from "fastify";
import {
  FESTE_EXPORT_SPALTEN,
  STANDARD_EXPORT_SPALTEN,
  exportWert,
  istKategoriefeld,
  kategoriefeldSchluessel,
  leseSpalten,
} from "@poi-app/shared";
import { getProjectById } from "../repositories/projectRepository.js";
import { listPointsByProject } from "../repositories/pointRepository.js";
import { listCategoriesForProject, listUsedFieldDefs } from "../repositories/categoryRepository.js";
import { listPlansByProject } from "../repositories/planRepository.js";
import { listUsers } from "../repositories/userRepository.js";
import { getExportTemplateById } from "../repositories/exportTemplateRepository.js";
import { requireProjectAccess, scopedAssignedTo } from "../authorization.js";

function csvEscape(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Beschriftung einer Spalte fuer die Kopfzeile.
 *
 * Feste Spalten kennt der gemeinsame Katalog. Kategoriefelder sind frei
 * definiert, ihre Beschriftung wird deshalb aus den vorhandenen Vorlagen
 * gesucht; findet sich keine, steht der Schluessel selbst da - besser als eine
 * leere Kopfzelle.
 */
function spaltenBeschriftung(
  key: string,
  feldLabels: Map<string, string>
): string {
  const fest = FESTE_EXPORT_SPALTEN.find((s) => s.key === key);
  if (fest) return fest.label;
  if (istKategoriefeld(key)) {
    const feldKey = kategoriefeldSchluessel(key);
    return feldLabels.get(feldKey) ?? feldKey;
  }
  return key;
}

export async function exportRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  server.get<{
    Params: { id: string };
    // gewerk und categoryId werden von listPointsByProject unterstuetzt und vom
    // Client mitgeschickt; sie gehoeren deshalb auch in den Typ, sonst sieht es
    // hier so aus, als wuerden sie nicht ausgewertet.
    Querystring: {
      planId?: string;
      status?: string;
      bauabschnitt?: string;
      from?: string;
      to?: string;
      assignedTo?: string;
      gewerk?: string;
      categoryId?: string;
      /** Exportvorlage; ohne sie gilt der bisherige feste Spaltensatz. */
      templateId?: string;
    };
  }>("/api/projects/:id/points/export.csv", async (request, reply) => {
    const project = await getProjectById(request.params.id);
    if (!project) {
      return reply.status(404).send({ error: "Projekt nicht gefunden" });
    }
    if (!(await requireProjectAccess(request, reply, project.id))) return;

    const { templateId, ...filter } = request.query;

    let spalten: string[] = [...STANDARD_EXPORT_SPALTEN];
    let dateiZusatz = "";
    if (templateId) {
      const vorlage = await getExportTemplateById(templateId);
      if (!vorlage) {
        return reply.status(404).send({ error: "Exportvorlage nicht gefunden" });
      }
      // Eine Vorlage aus einem fremden Projekt waere ein Zugriff an der
      // Rechtepruefung vorbei - projektuebergreifende (project_id NULL) sind
      // ausdruecklich erlaubt.
      if (vorlage.project_id !== null && vorlage.project_id !== project.id) {
        return reply.status(403).send({ error: "Diese Vorlage gehört zu einem anderen Projekt" });
      }
      const ausVorlage = leseSpalten(vorlage.columns_json);
      if (ausVorlage.length > 0) {
        spalten = ausVorlage;
        dateiZusatz = `-${vorlage.name.replace(/[^A-Za-z0-9-_]+/g, "_")}`;
      }
    }

    const points = await listPointsByProject(project.id, {
      ...filter,
      assignedTo: scopedAssignedTo(request, filter.assignedTo),
    });
    const categories = await listCategoriesForProject(project.id);
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const users = await listUsers();
    const userById = new Map(users.map((u) => [u.id, u]));
    const plans = await listPlansByProject(project.id);
    const planById = new Map(plans.map((p) => [p.id, p]));
    const feldLabels = new Map((await listUsedFieldDefs()).map((f) => [f.key, f.label]));

    const kontext = {
      kategorieName: (id: string | null) => (id ? categoryById.get(id)?.name : undefined),
      personName: (id: string | null) => (id ? userById.get(id)?.display_name : undefined),
      planName: (id: string) => planById.get(id)?.name,
    };

    const header = spalten.map((key) => spaltenBeschriftung(key, feldLabels));
    const rows = points.map((point) => spalten.map((key) => exportWert(point, key, kontext)));

    const csv = [header, ...rows]
      .map((row) => row.map(csvEscape).join(","))
      .join("\r\n");
    // Byte Order Mark, damit Excel die Datei als UTF-8 erkennt - ohne sie
    // werden Umlaute zerlegt.
    const bom = "﻿";

    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="tickets-${project.id}${dateiZusatz}.csv"`
      )
      .send(bom + csv);
  });
}
