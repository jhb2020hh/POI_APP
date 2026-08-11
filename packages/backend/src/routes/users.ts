import type { FastifyInstance } from "fastify";
import {
  createUser,
  deleteUser,
  getUserByEmail,
  getUserById,
  listPendingUsers,
  listUsers,
  setUserApproved,
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

  // Konten aus der Selbstregistrierung, die auf Freischaltung warten.
  server.get(
    "/api/users/pending",
    { preHandler: requireRole(["admin"]) },
    async () => {
      return listPendingUsers();
    }
  );

  server.post<{ Params: { id: string } }>(
    "/api/users/:id/approve",
    { preHandler: requireRole(["admin"]) },
    async (request, reply) => {
      const geaendert = await setUserApproved(request.params.id, true);
      if (!geaendert) {
        return reply.status(404).send({ error: "Nutzer nicht gefunden" });
      }
      return reply.status(204).send();
    }
  );

  /**
   * Ablehnen entfernt das Konto vollstaendig.
   *
   * Ein bloss gesperrtes Konto koennte sich weiter anmelden und liefe bei jedem
   * Versuch in dieselbe Meldung, ohne dass jemand etwas daran aendert. Wer
   * faelschlich abgelehnt wurde, registriert sich schlicht neu.
   */
  server.delete<{ Params: { id: string } }>(
    "/api/users/:id",
    { preHandler: requireRole(["admin"]) },
    async (request, reply) => {
      const profil = await getUserById(request.params.id);
      if (!profil) {
        return reply.status(404).send({ error: "Nutzer nicht gefunden" });
      }
      if (profil.id === request.user.sub) {
        return reply
          .status(400)
          .send({ error: "Das eigene Konto kann nicht entfernt werden" });
      }
      try {
        await deleteUser(profil.id);
      } catch (error) {
        server.log.error({ error }, "Konto konnte nicht entfernt werden");
        return reply.status(502).send({ error: "Konto konnte nicht entfernt werden" });
      }
      return reply.status(204).send();
    }
  );

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
