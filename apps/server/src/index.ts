// Server entry point. Starts the Fastify app and the health check route.
import Fastify from "fastify";
import { sql } from "drizzle-orm";
import { loadConfig } from "./config.js";
import { createDbClient } from "./db/client.js";

const config = loadConfig();
const db = createDbClient(config);
const app = Fastify({ logger: true });

app.get("/api/v1/health", async (_request, reply) => {
  try {
    await db.execute(sql`select 1`);
    return reply.send({ status: "ok" });
  } catch (error) {
    app.log.error(error, "Health check failed: the database is not reachable.");
    return reply.status(503).send({ status: "error" });
  }
});

app
  .listen({ port: config.apiPort, host: "0.0.0.0" })
  .then(() => {
    app.log.info(`Server is ready. It listens on port ${config.apiPort}.`);
  })
  .catch((error: unknown) => {
    app.log.error(error, "Server failed to start.");
    process.exit(1);
  });
