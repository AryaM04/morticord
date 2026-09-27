// The `app.authenticate` preHandler. It checks the bearer access token and
// sets `request.auth`. The JWT stays stateless: a 15-minute expiry is the
// only bound, so this guard never queries the database.
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../errors.js";
import { verifyAccessToken } from "../modules/auth/tokens.js";

export interface AuthContext {
  userId: bigint;
  deviceId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}

export interface AuthGuardOptions {
  jwtSecret: string;
}

export const authGuardPlugin = fp<AuthGuardOptions>(async (app: FastifyInstance, options) => {
  app.decorateRequest("auth", undefined);

  app.decorate("authenticate", async function authenticate(request: FastifyRequest) {
    const header = request.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw new AppError(401, "NO_TOKEN", "The request needs a bearer access token.");
    }

    const token = header.slice("Bearer ".length).trim();
    try {
      const claims = await verifyAccessToken(options.jwtSecret, token);
      request.auth = { userId: claims.userId, deviceId: claims.deviceId };
    } catch {
      throw new AppError(401, "INVALID_ACCESS_TOKEN", "The access token is not valid or has expired.");
    }
  });
});
