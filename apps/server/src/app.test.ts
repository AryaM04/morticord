import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { serializeRequestForLog } from "./app.js";

describe("serializeRequestForLog", () => {
  it("does not log the query string, which can hold an OAuth code", () => {
    const request = {
      method: "GET",
      url: "/api/v1/auth/oauth/github/callback?code=secret-code&state=secret-state",
      ip: "203.0.113.1",
    } as FastifyRequest;

    const logged = serializeRequestForLog(request);

    expect(logged).toEqual({
      method: "GET",
      url: "/api/v1/auth/oauth/github/callback",
      remoteAddress: "203.0.113.1",
    });
    expect(JSON.stringify(logged)).not.toContain("secret");
  });
});
