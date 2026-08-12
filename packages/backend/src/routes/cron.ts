import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { versendeFaelligkeitsMails } from "../services/faelligkeiten.js";

/**
 * Zeitgesteuerte Ablaeufe.
 *
 * Bewusst *ohne* server.authenticate: der Aufruf kommt von Vercel Cron, nicht
 * von einem angemeldeten Nutzer. Abgesichert wird er ueber CRON_SECRET, das
 * Vercel bei gesetzter Umgebungsvariable automatisch als
 * `Authorization: Bearer <secret>` mitschickt.
 *
 * Ist CRON_SECRET nicht gesetzt, bleibt der Endpunkt gesperrt. Ein offener
 * Endpunkt, der Mails ausloest, waere aus dem Netz beliebig oft aufrufbar.
 */

function geheimnisStimmt(request: FastifyRequest): boolean {
  const erwartet = process.env.CRON_SECRET;
  if (!erwartet) return false;

  const kopf = request.headers.authorization ?? "";
  const uebergeben = kopf.startsWith("Bearer ")
    ? kopf.slice(7)
    : (request.headers["x-cron-secret"] as string | undefined) ?? "";

  const a = Buffer.from(uebergeben);
  const b = Buffer.from(erwartet);
  // timingSafeEqual verlangt gleiche Laenge - die Laenge selbst ist kein
  // Geheimnis, deshalb wird sie vorher geprueft.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function cronRoutes(server: FastifyInstance): Promise<void> {
  /**
   * Vercel Cron ruft mit GET auf. POST bleibt zusaetzlich offen, damit sich der
   * Lauf von Hand ausloesen laesst, ohne dass ein versehentlicher Seitenaufruf
   * im Browser Mails verschickt.
   */
  const handler = async (
    request: FastifyRequest<{ Querystring: { trockenlauf?: string; stichtag?: string } }>,
    reply: FastifyReply
  ) => {
    if (!geheimnisStimmt(request)) {
      const grund = process.env.CRON_SECRET
        ? "CRON_SECRET stimmt nicht"
        : "CRON_SECRET ist nicht gesetzt";
      server.log.warn({ grund }, "Cron-Aufruf abgewiesen");
      return reply.status(401).send({ error: "nicht berechtigt" });
    }

    const trockenlauf =
      request.query.trockenlauf === "1" || request.query.trockenlauf === "true";

    try {
      const bericht = await versendeFaelligkeitsMails({
        trockenlauf,
        stichtag: request.query.stichtag,
      });
      server.log.info({ bericht }, "Faelligkeitsversand gelaufen");
      return bericht;
    } catch (error) {
      server.log.error({ error }, "Faelligkeitsversand fehlgeschlagen");
      return reply.status(500).send({
        error: "Faelligkeitsversand fehlgeschlagen",
        detail: (error as Error).message,
      });
    }
  };

  server.get("/api/cron/due-date-digest", handler);
  server.post("/api/cron/due-date-digest", handler);
}
