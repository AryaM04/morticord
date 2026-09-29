// Tests for the origin rules: CORS headers on the REST API, and the Origin
// check on the gateway upgrade. See origins.ts.
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { createFakeMailer } from "./mailer.js";
import { createOriginCheck } from "./origins.js";
import { createTestDb, describeWithDb, type TestDb } from "../test/db.js";
import { buildTestConfig, mkTempDataDir } from "../test/helpers.js";

const DESKTOP_ORIGIN = "http://tauri.localhost";
const OTHER_ORIGIN = "https://evil.example.com";

describe("createOriginCheck", () => {
  const isAllowed = createOriginCheck({
    webOrigin: "http://localhost:5173",
    corsAllowedOrigins: [DESKTOP_ORIGIN, "tauri://localhost"],
  });

  it("lets through a request without an Origin header", () => {
    expect(isAllowed(undefined, "localhost:3000")).toBe(true);
  });

  it("allows the web origin, the allow-list and the same host", () => {
    expect(isAllowed("http://localhost:5173", "localhost:3000")).toBe(true);
    expect(isAllowed(DESKTOP_ORIGIN, "localhost:3000")).toBe(true);
    expect(isAllowed("tauri://localhost", "localhost:3000")).toBe(true);
    expect(isAllowed("https://chat.example.com", "chat.example.com")).toBe(true);
  });

  it("refuses other origins", () => {
    expect(isAllowed(OTHER_ORIGIN, "localhost:3000")).toBe(false);
    expect(isAllowed("null", "localhost:3000")).toBe(false);
    expect(isAllowed("http://localhost:5174", "localhost:3000")).toBe(false);
  });
});

/** Open a WebSocket with an optional Origin header. Resolve with "open" or the refusal status. */
function tryConnect(url: string, origin?: string): Promise<"open" | number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, origin ? { origin } : {});
    ws.once("open", () => {
      ws.close();
      resolve("open");
    });
    ws.once("unexpected-response", (_request, response) => {
      resolve(response.statusCode ?? 0);
      ws.terminate();
    });
    ws.once("error", (error) => {
      // "unexpected-response" already resolved, or this is a real failure.
      reject(error);
    });
  });
}

describeWithDb("origin rules", () => {
  let testDb: TestDb;
  let allowListApp: FastifyInstance;
  let defaultApp: FastifyInstance;
  let gatewayUrl: string;

  beforeAll(async () => {
    testDb = await createTestDb();
    allowListApp = await buildApp({
      db: testDb.db,
      config: buildTestConfig({ dataDir: await mkTempDataDir(), corsAllowedOrigins: [DESKTOP_ORIGIN] }),
      mailer: createFakeMailer(),
      rateLimit: false,
    });
    defaultApp = await buildApp({
      db: testDb.db,
      config: buildTestConfig({ dataDir: await mkTempDataDir() }),
      mailer: createFakeMailer(),
      rateLimit: false,
    });
    await allowListApp.listen({ port: 0, host: "127.0.0.1" });
    const address = allowListApp.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    gatewayUrl = `ws://127.0.0.1:${port}/gateway`;
  });

  afterAll(async () => {
    await allowListApp.close();
    await defaultApp.close();
    await testDb.close();
  });

  it("answers a preflight from an allowed origin, with the Authorization header and no credentials", async () => {
    const response = await allowListApp.inject({
      method: "OPTIONS",
      url: "/api/v1/users/@me",
      headers: {
        origin: DESKTOP_ORIGIN,
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(DESKTOP_ORIGIN);
    expect(String(response.headers["access-control-allow-headers"]).toLowerCase()).toContain("authorization");
    expect(String(response.headers["access-control-allow-methods"])).toContain("PATCH");
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("sends the CORS header to an allowed origin only", async () => {
    const allowed = await allowListApp.inject({ method: "GET", url: "/api/v1/health", headers: { origin: DESKTOP_ORIGIN } });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe(DESKTOP_ORIGIN);

    const denied = await allowListApp.inject({ method: "GET", url: "/api/v1/health", headers: { origin: OTHER_ORIGIN } });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("sends no CORS header when the allow-list is empty", async () => {
    const response = await defaultApp.inject({ method: "GET", url: "/api/v1/health", headers: { origin: DESKTOP_ORIGIN } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("opens the gateway for an allowed origin, the web origin, the same host and a client without an origin", async () => {
    expect(await tryConnect(gatewayUrl, DESKTOP_ORIGIN)).toBe("open");
    expect(await tryConnect(gatewayUrl, "http://localhost:5173")).toBe("open");
    expect(await tryConnect(gatewayUrl, gatewayUrl.replace("ws://", "http://").replace("/gateway", ""))).toBe("open");
    expect(await tryConnect(gatewayUrl)).toBe("open");
  });

  it("refuses the gateway upgrade from another origin with 403", async () => {
    expect(await tryConnect(gatewayUrl, OTHER_ORIGIN)).toBe(403);
  });
});
