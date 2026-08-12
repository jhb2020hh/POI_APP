import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import authPlugin from "./plugins/auth.js";
import { db, isDatabaseConfigured } from "./db/connection.js";
import { isSupabaseConfigured } from "./supabase.js";
import { isMailConfigured } from "./mail/resend.js";
import { projectRoutes } from "./routes/projects.js";
import { projectMemberRoutes } from "./routes/projectMembers.js";
import { userRoutes } from "./routes/users.js";
import { planRoutes } from "./routes/plans.js";
import { planFolderRoutes } from "./routes/planFolders.js";
import { categoryRoutes } from "./routes/categories.js";
import { pointRoutes } from "./routes/points.js";
import { attachmentRoutes } from "./routes/attachments.js";
import { pointDetailRoutes } from "./routes/pointDetails.js";
import { exportRoutes } from "./routes/export.js";
import { exportTemplateRoutes } from "./routes/exportTemplates.js";
import { statsRoutes } from "./routes/stats.js";
import { offlineRoutes } from "./routes/offline.js";
import { syncRoutes } from "./routes/sync.js";
import { settingsRoutes } from "./routes/settings.js";
import { cronRoutes } from "./routes/cron.js";

/**
 * Baut die Fastify-Anwendung, ohne zu lauschen.
 *
 * Getrennt von server.ts, weil dieselbe Anwendung auf zwei Wegen betrieben wird:
 * lokal ueber server.ts mit einem echten Port, auf Vercel ueber api/[...path].ts
 * als Serverless-Function ohne eigenen Listener.
 *
 * Migrationen laufen hier bewusst nicht mit - sie sind ein eigener Befehl
 * (npm run db:migrate), sonst wuerde jeder Kaltstart einer Function das Schema
 * anfassen.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: true,
    // Vercel terminiert TLS und setzt X-Forwarded-*. Ohne diese Einstellung
    // wuerde Fastify die interne Proxy-Adresse als Client-IP protokollieren.
    trustProxy: true,
  });

  // Mitschreiben, welche Routen tatsaechlich registriert werden. Auf Vercel
  // laesst sich sonst nicht unterscheiden, ob eine 404 daher kommt, dass die
  // Route fehlt (aelterer Stand ausgeliefert), oder daher, dass die Anfrage die
  // Function gar nicht erreicht hat.
  const registrierteRouten: string[] = [];
  server.addHook("onRoute", (route) => {
    const methoden = Array.isArray(route.method) ? route.method : [route.method];
    for (const methode of methoden) {
      if (methode === "HEAD") continue;
      registrierteRouten.push(`${methode} ${route.url}`);
    }
  });

  await server.register(authPlugin);

  /**
   * Meldet nicht nur "erreichbar", sondern auch, ob die Umgebung vollstaendig
   * ist und die Datenbank antwortet. Gemeldet wird ausschliesslich, *ob* ein
   * Wert gesetzt ist - niemals der Wert selbst.
   *
   * Ohne diese Auskunft bleibt bei einer Fehlkonfiguration nur eine 500 ohne
   * Hinweis, und in einer Serverless-Umgebung kommt man an die Ursache sonst
   * nur ueber die Protokolle des Anbieters.
   */
  server.get("/api/health", async () => {
    const konfiguration = {
      datenbank: isDatabaseConfigured,
      supabase: isSupabaseConfigured,
      mailversand: isMailConfigured,
      cronGeheimnis: Boolean(process.env.CRON_SECRET),
    };

    let datenbankverbindung: string;
    if (!isDatabaseConfigured) {
      datenbankverbindung = "nicht konfiguriert";
    } else {
      try {
        await db.prepare("SELECT 1").get();
        datenbankverbindung = "ok";
      } catch (error) {
        datenbankverbindung = `Fehler: ${(error as Error).message}`;
      }
    }

    const vollstaendig =
      konfiguration.datenbank && konfiguration.supabase && datenbankverbindung === "ok";

    return {
      status: vollstaendig ? "ok" : "unvollstaendig",
      konfiguration,
      datenbankverbindung,
      routen: [...registrierteRouten].sort(),
    };
  });

  await server.register(projectRoutes);
  await server.register(projectMemberRoutes);
  await server.register(userRoutes);
  await server.register(planRoutes);
  await server.register(planFolderRoutes);
  await server.register(categoryRoutes);
  await server.register(pointRoutes);
  await server.register(attachmentRoutes);
  await server.register(pointDetailRoutes);
  await server.register(exportRoutes);
  await server.register(exportTemplateRoutes);
  await server.register(statsRoutes);
  await server.register(offlineRoutes);
  await server.register(syncRoutes);
  await server.register(settingsRoutes);
  await server.register(cronRoutes);

  return server;
}
