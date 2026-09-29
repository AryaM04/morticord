// Builds the Fastify app. It does not listen; index.ts does that.
// Tests call buildApp with test dependencies (a test database, a fake mailer).
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { sql } from "drizzle-orm";
import type { AppConfig } from "./config.js";
import type { DbClient } from "./db/client.js";
import { registerErrorHandler } from "./errors.js";
import { registerGatewayRoute, MAX_PAYLOAD_BYTES, type GatewayTimingOptions } from "./modules/gateway/handler.js";
import { GatewayService } from "./modules/gateway/service.js";
import type { Mailer } from "./mailer.js";
import { authGuardPlugin } from "./plugins/auth-guard.js";
import { registerAttachmentRoutes } from "./modules/attachments/routes.js";
import { startAttachmentCleanup } from "./modules/attachments/service.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { registerDmRoutes } from "./modules/dms/routes.js";
import { registerFriendRoutes } from "./modules/friends/routes.js";
import { registerGuildRoutes } from "./modules/guilds/routes.js";
import { registerKeyRoutes } from "./modules/keys/routes.js";
import { registerLinkPreviewRoutes, type LinkPreviewRouteOptions } from "./modules/link-preview/routes.js";
import { registerMessageRoutes } from "./modules/messages/routes.js";
import { registerSettingsRoutes } from "./modules/settings/routes.js";
import { registerToDeviceRoutes } from "./modules/to-device/routes.js";
import { ToDeviceDelivery, TO_DEVICE_QUEUE_LIMIT } from "./modules/to-device/service.js";
import { registerUserRoutes } from "./modules/users/routes.js";
import { CallRinger } from "./modules/voice/calls.js";
import { registerVoiceRoutes } from "./modules/voice/routes.js";
import { VoiceService } from "./modules/voice/service.js";

export interface AppDeps {
  config: AppConfig;
  db: DbClient;
  mailer: Mailer;
  /** Turn the rate limiter on or off. Defaults to on. Tests that make many
   * fast requests to the same route can turn it off, to test other things. */
  rateLimit?: boolean;
  /** The gateway hub. Tests can pass one in to inspect it; buildApp makes
   * one when it is left out. */
  gateway?: GatewayService;
  /** Shorter heartbeat/identify timers for tests, so they do not sleep for real seconds. */
  gatewayTiming?: GatewayTimingOptions;
  /** The voice hub. Tests can pass one in to inspect it; buildApp makes one when it is left out. */
  voice?: VoiceService;
  /** How long a disconnected voice peer's state stays, in case it resumes. Tests can shorten it. */
  voiceGraceMs?: number;
  /** How long a DM call rings. Tests can shorten it. Default 30 s. */
  callRingMs?: number;
  /** The DM call ringer. buildApp makes one when it is left out. */
  ringer?: CallRinger;
  /** The most queued to-device messages for each device. Tests can lower it. */
  toDeviceQueueLimit?: number;
  /** Replaces parts of the link preview route. Tests use it. */
  linkPreview?: LinkPreviewRouteOptions;
}

const IMAGE_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"];

export async function buildApp(rawDeps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: rawDeps.config.logFile ? { file: rawDeps.config.logFile } : true });
  const gateway = rawDeps.gateway ?? new GatewayService();
  await gateway.primeFromDatabase(rawDeps.db);
  const voice = rawDeps.voice ?? new VoiceService(rawDeps.voiceGraceMs);
  const ringer = rawDeps.ringer ?? new CallRinger(gateway, rawDeps.callRingMs);
  const deps: AppDeps = { ...rawDeps, gateway, voice, ringer };
  const delivery = new ToDeviceDelivery(deps.db, gateway, app.log);
  app.addHook("onClose", async () => ringer.dispose());
  const stopCleanup = startAttachmentCleanup(deps.db, deps.config.dataDir, app.log);
  app.addHook("onClose", async () => stopCleanup());

  // Raw image bytes for the avatar upload route. Fastify parses only JSON
  // and text by default, so image bodies need their own parser.
  app.addContentTypeParser(IMAGE_CONTENT_TYPES, { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  await app.register(cookie, { secret: deps.config.jwtSecret });
  // Other origins, such as the desktop app, get CORS headers. Without an
  // allow-list the server sends none, so only the web app origin can call it.
  if (deps.config.corsAllowedOrigins.length > 0) {
    await app.register(cors, {
      origin: deps.config.corsAllowedOrigins,
      credentials: false,
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
      allowedHeaders: ["Authorization", "Content-Type"],
      maxAge: 600,
    });
  }
  if (deps.rateLimit !== false) {
    await app.register(rateLimit, { global: false });
  }
  await app.register(authGuardPlugin, { jwtSecret: deps.config.jwtSecret });
  await app.register(websocket, { options: { maxPayload: MAX_PAYLOAD_BYTES } });

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
  await app.register(async (instance) => registerFriendRoutes(instance, deps), { prefix: "/api/v1" });
  await app.register(async (instance) => registerDmRoutes(instance, deps), { prefix: "/api/v1" });
  await app.register(async (instance) => registerSettingsRoutes(instance, deps), { prefix: "/api/v1" });
  await app.register(async (instance) => registerGuildRoutes(instance, deps), { prefix: "/api/v1" });
  await app.register(async (instance) => registerMessageRoutes(instance, deps), { prefix: "/api/v1" });
  await app.register(async (instance) => registerVoiceRoutes(instance, deps), { prefix: "/api/v1" });
  await app.register(async (instance) => registerKeyRoutes(instance, deps), { prefix: "/api/v1" });
  await app.register(async (instance) => registerAttachmentRoutes(instance, deps), { prefix: "/api/v1" });
  await app.register(async (instance) => registerLinkPreviewRoutes(instance, deps, deps.linkPreview), {
    prefix: "/api/v1",
  });
  await app.register(
    async (instance) =>
      registerToDeviceRoutes(instance, { ...deps, delivery, toDeviceQueueLimit: deps.toDeviceQueueLimit ?? TO_DEVICE_QUEUE_LIMIT }),
    { prefix: "/api/v1" },
  );
  registerGatewayRoute(
    app,
    { db: deps.db, config: deps.config, gateway, voice, ringer, delivery, toDeviceQueueLimit: deps.toDeviceQueueLimit },
    deps.gatewayTiming,
  );

  return app;
}
