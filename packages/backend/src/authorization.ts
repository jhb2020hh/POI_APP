import type { FastifyReply, FastifyRequest } from "fastify";
import { isMember } from "./repositories/projectMemberRepository.js";

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

export function canAccessProject(request: FastifyRequest, projectId: string): boolean {
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

export function requireProjectAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  projectId: string
): boolean {
  if (!canAccessProject(request, projectId)) {
    reply.status(403).send({ error: "kein Zugriff auf dieses Projekt" });
    return false;
  }
  return true;
}
