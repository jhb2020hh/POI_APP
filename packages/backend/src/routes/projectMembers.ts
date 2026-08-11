import type { FastifyInstance } from "fastify";
import { getProjectById } from "../repositories/projectRepository.js";
import { getUserByEmail } from "../repositories/userRepository.js";
import {
  addMember,
  listMembersForProject,
  removeMember,
} from "../repositories/projectMemberRepository.js";
import { requireProjectAccess, requireRole } from "../authorization.js";

export async function projectMemberRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  server.get<{ Params: { id: string } }>(
    "/api/projects/:id/members",
    async (request, reply) => {
      const project = await getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      if (!(await requireProjectAccess(request, reply, project.id))) return;
      return listMembersForProject(project.id);
    }
  );

  server.post<{ Params: { id: string }; Body: { email: string } }>(
    "/api/projects/:id/members",
    { preHandler: requireRole(["admin"]) },
    async (request, reply) => {
      const project = await getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      const user = await getUserByEmail(request.body.email);
      if (!user) {
        return reply.status(404).send({ error: "Nutzer nicht gefunden" });
      }
      await addMember(project.id, user.id);
      return reply.status(201).send({ projectId: project.id, userId: user.id });
    }
  );

  server.delete<{ Params: { id: string; userId: string } }>(
    "/api/projects/:id/members/:userId",
    { preHandler: requireRole(["admin"]) },
    async (request, reply) => {
      const project = await getProjectById(request.params.id);
      if (!project) {
        return reply.status(404).send({ error: "Projekt nicht gefunden" });
      }
      await removeMember(project.id, request.params.userId);
      return reply.status(204).send();
    }
  );
}
