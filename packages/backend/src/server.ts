import { buildApp } from "./app.js";

// Lokaler Entwicklungsserver. Das Frontend wird dabei von Vite ausgeliefert,
// das /api und /ws an diesen Port weiterreicht (siehe vite.config.ts).
// In der Cloud wird stattdessen api/[...path].ts verwendet.
const port = Number(process.env.PORT ?? 3001);

const server = await buildApp();

server.listen({ port, host: "0.0.0.0" }).catch((err) => {
  server.log.error(err);
  process.exit(1);
});
