import type { FastifyInstance } from "fastify";
import {
  createUser,
  getUserByEmail,
  getUserById,
  listUsers,
} from "../repositories/userRepository.js";
import { requireRole, ROLES } from "../authorization.js";

export async function userRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  /**
   * Profil des angemeldeten Nutzers. Frueher kam diese Auskunft aus der Antwort
   * von /api/auth/login; die Anmeldung laeuft jetzt direkt gegen Supabase, das
   * die anwendungseigene Rolle nicht kennt.
   */
  server.get("/api/me", async (request) => {
    const profile = await getUserById(request.user.sub);
    return {
      id: request.user.sub,
      email: request.user.email,
      role: request.user.role,
      displayName: profile?.display_name ?? request.user.email,
    };
  });

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
      if (await getUserByEmail(email)) {
        return reply.status(409).send({ error: "Nutzer mit dieser E-Mail existiert bereits" });
      }
      try {
        const user = await createUser({ email, password, displayName, role });
        return reply.status(201).send({
          id: user.id,
          email: user.email,
          display_name: user.display_name,
          role: user.role,
        });
      } catch (error) {
        server.log.error({ error }, "Nutzer konnte nicht angelegt werden");
        return reply.status(502).send({
          error: "Nutzer konnte nicht angelegt werden",
        });
      }
    }
  );
}
