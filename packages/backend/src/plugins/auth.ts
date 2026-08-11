import fp from "fastify-plugin";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import type { JWTPayload } from "jose";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SUPABASE_URL } from "../supabase.js";
import { ensureProfile, getUserById } from "../repositories/userRepository.js";

declare module "fastify" {
  interface FastifyRequest {
    user: { sub: string; email: string; role: string };
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

// Neuere Supabase-Projekte signieren asymmetrisch und veroeffentlichen die
// oeffentlichen Schluessel; aeltere nutzen ein gemeinsames HS256-Geheimnis.
// Beides wird unterstuetzt, damit die Umstellung nicht davon abhaengt, wann das
// Projekt angelegt wurde. Der Schluesselsatz wird von jose zwischengespeichert.
// Erst bei Bedarf aufgebaut: ohne gesetzte SUPABASE_URL wuerde `new URL(...)`
// schon beim Laden des Moduls fehlschlagen und damit die gesamte Function
// unbrauchbar machen.
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) {
    if (!SUPABASE_URL) {
      throw new Error("SUPABASE_URL ist nicht gesetzt.");
    }
    jwks = createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}

const legacySecret = process.env.SUPABASE_JWT_SECRET;

async function verifyAccessToken(token: string): Promise<JWTPayload> {
  const header = decodeProtectedHeader(token);

  if (header.alg === "HS256") {
    if (!legacySecret) {
      throw new Error(
        "Token ist HS256-signiert, aber SUPABASE_JWT_SECRET ist nicht gesetzt."
      );
    }
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(legacySecret)
    );
    return payload;
  }

  const { payload } = await jwtVerify(token, getJwks());
  return payload;
}

export default fp(async function authPlugin(server: FastifyInstance) {
  server.decorate(
    "authenticate",
    async function (request: FastifyRequest, reply: FastifyReply) {
      const header = request.headers.authorization;
      if (!header?.startsWith("Bearer ")) {
        return reply.status(401).send({ error: "nicht authentifiziert" });
      }

      let payload: JWTPayload;
      try {
        payload = await verifyAccessToken(header.slice("Bearer ".length));
      } catch {
        return reply.status(401).send({ error: "nicht authentifiziert" });
      }

      const userId = payload.sub;
      const email = typeof payload.email === "string" ? payload.email : "";
      if (!userId) {
        return reply.status(401).send({ error: "nicht authentifiziert" });
      }

      // Die Rolle wird aus der Profiltabelle gelesen, nicht aus dem Token:
      // ein Rollenentzug wirkt damit sofort und nicht erst, wenn das bereits
      // ausgestellte Token ablaeuft.
      let profile = await getUserById(userId);
      if (!profile) {
        // Konto in der Supabase-Oberflaeche angelegt, aber noch nie eingeloggt.
        const metadataRole =
          typeof (payload.app_metadata as { role?: unknown } | undefined)?.role === "string"
            ? ((payload.app_metadata as { role: string }).role)
            : undefined;
        profile = await ensureProfile({ id: userId, email, role: metadataRole });
      }

      // Selbstregistrierte Konten bleiben gesperrt, bis ein Admin sie
      // freischaltet. Eigener Fehlercode, damit das Frontend "wartet auf
      // Freischaltung" von "keine Berechtigung" unterscheiden kann - sonst
      // stuende der Nutzer vor einer Meldung, die ihn zum Support schickt,
      // obwohl er nur warten muss.
      if (!profile.approved) {
        return reply.status(403).send({
          error:
            "Dein Zugang wurde noch nicht freigeschaltet. Ein Administrator prüft die Anmeldung.",
          code: "NICHT_FREIGESCHALTET",
        });
      }

      request.user = {
        sub: profile.id,
        email: profile.email,
        role: profile.role,
      };
    }
  );
});
