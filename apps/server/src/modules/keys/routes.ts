// Key server routes. Each handler validates input and calls the service.
// See docs/concepts/olm-megolm.md sections 3 and 4.
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  claimKeysRequestSchema,
  putMasterKeyRequestSchema,
  queryKeysRequestSchema,
  uploadKeysRequestSchema,
} from "@discord-clone/shared";
import type { AppDeps } from "../../app.js";
import { AppError } from "../../errors.js";
import { createEventRateLimiter, type EventRateLimiter } from "../messages/service.js";
import { claimKeys, putMasterKey, queryKeys, uploadKeys } from "./service.js";

const REQUESTS_PER_MINUTE = 60;

/** Throw 429 when this user called the route too often in the last minute. */
export function checkRate(limiter: EventRateLimiter, userId: bigint): void {
  const limit = limiter.check(userId);
  if (!limit.allowed) {
    throw new AppError(429, "RATE_LIMITED", "Too many requests. Try again later.");
  }
}

export async function registerKeyRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const keysDeps = { db: deps.db, gateway: deps.gateway };
  const uploadLimiter = createEventRateLimiter(REQUESTS_PER_MINUTE, 60_000);
  const queryLimiter = createEventRateLimiter(REQUESTS_PER_MINUTE, 60_000);
  const claimLimiter = createEventRateLimiter(REQUESTS_PER_MINUTE, 60_000);

  app.post("/keys/upload", { preHandler: app.authenticate }, async (request, reply: FastifyReply) => {
    const { userId, deviceId } = request.auth!;
    checkRate(uploadLimiter, userId);
    const input = uploadKeysRequestSchema.parse(request.body);
    return reply.send(await uploadKeys(keysDeps, userId, deviceId, input));
  });

  app.put("/keys/master", { preHandler: app.authenticate }, async (request, reply) => {
    const { userId, deviceId } = request.auth!;
    checkRate(uploadLimiter, userId);
    const input = putMasterKeyRequestSchema.parse(request.body);
    await putMasterKey(keysDeps, userId, deviceId, input);
    return reply.status(204).send();
  });

  app.post("/keys/query", { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = request.auth!;
    checkRate(queryLimiter, userId);
    const input = queryKeysRequestSchema.parse(request.body);
    const users = await queryKeys(
      deps.db,
      userId,
      input.userIds.map((id) => BigInt(id)),
    );
    return reply.send({ users });
  });

  app.post("/keys/claim", { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = request.auth!;
    checkRate(claimLimiter, userId);
    const input = claimKeysRequestSchema.parse(request.body);
    return reply.send({ keys: await claimKeys(deps.db, userId, input.devices) });
  });
}
