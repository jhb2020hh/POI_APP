import type { FastifyInstance } from "fastify";
import { createUser, getUserByEmail, listUsers } from "../repositories/userRepository.js";
import { requireRole, ROLES } from "../authorization.js";

export async function userRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  server.get("/api/users", async () => {
    return listUsers();
  });

  server.post<{
    Body: { email: string; password: string; displayName: string; role: string };
  }>(
    "/api/users",
    { preHandler: requireRole(["admin"]) },
    async (request, reply) => {
      const { email, password, displayName, role } = request.body;
      if (!email || !password || !displayName || !role) {
        return reply
          .status(400)
          .send({ error: "email, password, displayName und role sind erforderlich" });
      }
      if (!ROLES.includes(role as (typeof ROLES)[number])) {
        return reply.status(400).send({ error: `Ungültige Rolle. Erlaubt: ${ROLES.join(", ")}` });
      }
      if (getUserByEmail(email)) {
        return reply.status(409).send({ error: "Nutzer mit dieser E-Mail existiert bereits" });
      }
      const user = await createUser({ email, password, displayName, role });
      return reply.status(201).send({
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        role: user.role,
      });
    }
  );
}
