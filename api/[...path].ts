import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";

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
    // Bewusst als dynamischer Import innerhalb der Funktion: bei einem
    // statischen Import oben wuerde ein Fehler beim Laden des Moduls die
    // Function abstuerzen lassen, bevor irgendein eigener Code laeuft. Vercel
    // meldet dann nur FUNCTION_INVOCATION_FAILED ohne Hinweis auf die Ursache.
    appPromise = import("@poi-app/backend/app").then(async ({ buildApp }) => {
      const app = await buildApp();
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
  let app: FastifyInstance;
  try {
    app = await getApp();
  } catch (error) {
    // Naechster Aufruf soll es erneut versuchen duerfen - sonst bliebe eine
    // Instanz nach einem einmaligen Fehler dauerhaft defekt.
    appPromise = undefined;

    const message = error instanceof Error ? error.message : String(error);
    console.error("Anwendung konnte nicht gestartet werden:", error);

    // Nur die Meldung, nicht der Aufrufpfad: die Meldung benennt die Ursache
    // ("... ist nicht gesetzt", "Cannot find module ..."), ohne interne
    // Struktur preiszugeben.
    response.statusCode = 500;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(
      JSON.stringify({
        error: "Anwendung konnte nicht gestartet werden",
        ursache: message,
      })
    );
    return;
  }

  // Fastify bringt einen eigenen http.Server mit, der hier nicht lauscht.
  // Das Weiterreichen des Request-Events laesst Fastify die Anfrage trotzdem
  // vollstaendig verarbeiten - inklusive Routing, Hooks und Fehlerbehandlung.
  app.server.emit("request", request, response);
}
