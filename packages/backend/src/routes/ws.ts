import type { FastifyInstance } from "fastify";
import { getPlanById } from "../repositories/planRepository.js";
import { subscribe } from "../ws/hub.js";
import { isMember } from "../repositories/projectMemberRepository.js";

export async function wsRoutes(server: FastifyInstance): Promise<void> {
  server.get<{ Params: { planId: string }; Querystring: { token?: string } }>(
    "/ws/plans/:planId",
    { websocket: true },
    (socket, request) => {
      const { token } = request.query;
      if (!token) {
        socket.close(4001, "kein Token");
        return;
      }
      let payload: { sub: string; role: string };
      try {
        payload = server.jwt.verify(token);
      } catch {
        socket.close(4001, "ungueltiges Token");
        return;
      }

      const plan = getPlanById(request.params.planId);
      if (!plan) {
        socket.close(4004, "Plan nicht gefunden");
        return;
      }

      if (payload.role !== "admin" && !isMember(plan.project_id, payload.sub)) {
        socket.close(4403, "kein Zugriff auf dieses Projekt");
        return;
      }

      subscribe(request.params.planId, socket);
      socket.send(JSON.stringify({ type: "connected", planId: request.params.planId }));
    }
  );
}
