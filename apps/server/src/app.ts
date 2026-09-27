// Builds the Fastify app. It does not listen; index.ts does that.
// Tests call buildApp with test dependencies (a test database, a fake mailer).
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { sql } from "drizzle-orm";
import type { AppConfig } from "./config.js";
import type { DbClient } from "./db/client.js";
import { registerErrorHandler } from "./errors.js";
import type { Mailer } from "./mailer.js";
import { authGuardPlugin } from "./plugins/auth-guard.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { registerGuildRoutes } from "./modules/guilds/routes.js";
import { registerUserRoutes } from "./modules/users/routes.js";

export interface AppDeps {
  config: AppConfig;
  db: DbClient;
  mailer: Mailer;
  /** Turn the rate limiter on or off. Defaults to on. Tests that make many
   * fast requests to the same route can turn it off, to test other things. */
  rateLimit?: boolean;
}

const IMAGE_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"];

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  // Raw image bytes for the avatar upload route. Fastify parses only JSON
  // and text by default, so image bodies need their own parser.
  app.addContentTypeParser(IMAGE_CONTENT_TYPES, { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  await app.register(cookie, { secret: deps.config.jwtSecret });
  if (deps.rateLimit !== false) {
    await app.register(rateLimit, { global: false });
  }
  await app.register(authGuardPlugin, { jwtSecret: deps.config.jwtSecret });

  registerErrorHandler(app);

  app.get("/api/v1/health", async (_request, reply) => {
    try {
      await deps.db.execute(sql`select 1`);
      return reply.send({ status: "ok" });
    } catch (error) {
      app.log.error(error, "Health check failed: the database is not reachable.");
      return reply.status(503).send({ status: "error" });
    }
  });

  await app.register(async (instance) => registerAuthRoutes(instance, deps), { prefix: "/api/v1/auth" });
  await app.register(async (instance) => registerUserRoutes(instance, deps), { prefix: "/api/v1" });
  await app.register(async (instance) => registerGuildRoutes(instance, deps), { prefix: "/api/v1" });

  return app;
}
