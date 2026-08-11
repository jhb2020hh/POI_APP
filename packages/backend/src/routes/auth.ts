import type { FastifyInstance } from "fastify";
import { getUserByEmail, verifyPassword } from "../repositories/userRepository.js";

export async function authRoutes(server: FastifyInstance): Promise<void> {
  server.post<{ Body: { email: string; password: string } }>(
    "/api/auth/login",
    async (request, reply) => {
      const { email, password } = request.body;
      const user = email ? getUserByEmail(email) : undefined;
      if (!user || !(await verifyPassword(user, password ?? ""))) {
        return reply.status(401).send({ error: "E-Mail oder Passwort falsch" });
      }
      const token = server.jwt.sign(
        { sub: user.id, email: user.email, role: user.role },
        { expiresIn: "12h" }
      );
      return {
        token,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          role: user.role,
        },
      };
    }
  );
}
