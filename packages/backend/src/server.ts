import Fastify from "fastify";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMigrations } from "./db/migrate.js";
import { db } from "./db/connection.js";
import authPlugin from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
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
import { statsRoutes } from "./routes/stats.js";
import { wsRoutes } from "./routes/ws.js";
import { offlineRoutes } from "./routes/offline.js";
import { syncRoutes } from "./routes/sync.js";
import { settingsRoutes } from "./routes/settings.js";

runMigrations();

const server = Fastify({ logger: true });

await server.register(multipart, {
  limits: { fileSize: 100 * 1024 * 1024 },
});
await server.register(websocket);
await server.register(authPlugin);

server.get("/api/health", async () => {
  return { status: "ok" };
});

await server.register(authRoutes);
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
await server.register(statsRoutes);
await server.register(wsRoutes);
await server.register(offlineRoutes);
await server.register(syncRoutes);
await server.register(settingsRoutes);

server.get("/api/debug/users-count", async () => {
  const row = db.prepare("SELECT COUNT(*) AS count FROM users").get() as {
    count: number;
  };
  return { count: row.count };
});

server.post("/api/debug/loadtest-write", async () => {
  const result = db
    .prepare("INSERT INTO loadtest_rows DEFAULT VALUES")
    .run();
  return { id: Number(result.lastInsertRowid) };
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.join(__dirname, "..", "..", "frontend", "dist");

await server.register(fastifyStatic, {
  root: frontendDist,
  index: "index.html",
});

const port = Number(process.env.PORT ?? 3001);

server.listen({ port, host: "0.0.0.0" }).catch((err) => {
  server.log.error(err);
  process.exit(1);
});
