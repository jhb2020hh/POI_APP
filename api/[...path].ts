import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { buildApp } from "@poi-app/backend/app";

/**
 * Eintrittspunkt fuer Vercel. Alle /api/*-Anfragen landen hier und werden an
 * dieselbe Fastify-Anwendung durchgereicht, die lokal ueber server.ts laeuft.
 *
 * Die Instanz haengt am Modul-Scope: Vercel friert eine Function-Instanz
 * zwischen Anfragen ein und taut sie wieder auf, sodass der Aufbau nur beim
 * Kaltstart anfaellt. Die Promise wird gespeichert (nicht die fertige App),
 * damit zwei gleichzeitig eintreffende Anfragen waehrend eines Kaltstarts nicht
 * beide eine eigene Anwendung bauen.
 */
let appPromise: Promise<FastifyInstance> | undefined;

async function getApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = buildApp().then(async (app) => {
      await app.ready();
      return app;
    });
  }
  return appPromise;
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const app = await getApp();
  // Fastify bringt einen eigenen http.Server mit, der hier nicht lauscht.
  // Das Weiterreichen des Request-Events laesst Fastify die Anfrage trotzdem
  // vollstaendig verarbeiten - inklusive Routing, Hooks und Fehlerbehandlung.
  app.server.emit("request", request, response);
}
