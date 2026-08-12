import type { FastifyReply, FastifyRequest } from "fastify";
import { isMember } from "./repositories/projectMemberRepository.js";
import { getProjectById } from "./repositories/projectRepository.js";

export const ROLES = ["extern", "mitarbeiter", "admin"] as const;
export type Role = (typeof ROLES)[number];

export function hasRole(request: FastifyRequest, roles: Role[]): boolean {
  return roles.includes(request.user.role as Role);
}

export function requireRole(roles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!hasRole(request, roles)) {
      reply.status(403).send({ error: "keine Berechtigung für diese Aktion" });
    }
  };
}

export async function canAccessProject(
  request: FastifyRequest,
  projectId: string
): Promise<boolean> {
  if (request.user.role === "admin") return true;
  return isMember(projectId, request.user.sub);
}

/**
 * `extern`-Nutzer duerfen serverseitig nur Punkte sehen, denen sie selbst als
 * `assigned_to` zugeordnet sind - unabhaengig davon, was der Client anfragt.
 * An jeder Stelle verwenden, die Punkte/Tickets ausliest (Liste, Sync, Export, Offline).
 */
export function scopedAssignedTo(request: FastifyRequest, requested?: string): string | undefined {
  if (request.user.role === "extern") return request.user.sub;
  return requested;
}

export async function requireProjectAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  projectId: string
): Promise<boolean> {
  if (!(await canAccessProject(request, projectId))) {
    reply.status(403).send({ error: "kein Zugriff auf dieses Projekt" });
    return false;
  }
  return true;
}

/**
 * Zugriff *und* Schreibrecht: ein archiviertes Projekt bleibt lesbar, laesst
 * sich aber nicht mehr aendern.
 *
 * Bewusst eine einzige Funktion und nicht je Route eine eigene Abfrage. Es gibt
 * ueber ein Dutzend schreibende Endpunkte - Punkte, Zeichnungen, Anhaenge,
 * Kommentare, Kategorien, Mitglieder, Ordner, Sync. Verteilte Einzelpruefungen
 * waeren genau die Stelle, an der spaeter eine vergessen wird und ein
 * archiviertes Projekt doch wieder beschreibbar ist.
 *
 * In jeder schreibenden Route anstelle von requireProjectAccess verwenden.
 */
export async function requireProjectWritable(
  request: FastifyRequest,
  reply: FastifyReply,
  projectId: string
): Promise<boolean> {
  if (!(await requireProjectAccess(request, reply, projectId))) return false;

  const projekt = await getProjectById(projectId);
  if (projekt?.archived) {
    reply.status(409).send({
      error:
        "Dieses Projekt ist archiviert und kann nicht mehr geändert werden. " +
        "Ein Administrator kann es im Admin-Menü zurückholen.",
      code: "PROJEKT_ARCHIVIERT",
    });
    return false;
  }
  return true;
}
