// Tests for the API client's refresh logic: single-flight within a tab,
// retry after refresh, cross-tab "already rotated" reuse, and TOKEN_REUSED
// handling. Uses a fake IndexedDB (for the web platform) and a mocked
// fetch, so no real server is needed.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient, ApiError } from "./api.js";
import { webPlatform } from "./platform.js";

// Node has no Web Locks API. This tiny polyfill gives `navigator.locks`
// the same queuing behavior (one caller at a time, per lock name), so
// the single-flight refresh logic under test runs the same way it will
// run in a real browser tab.
function installLocksPolyfill(): void {
  const queues = new Map<string, Promise<unknown>>();
  const locks = {
    async request(name: string, callback: () => Promise<unknown>): Promise<unknown> {
      const previous = queues.get(name) ?? Promise.resolve();
      const run = previous.then(callback, callback);
      queues.set(
        name,
        run.then(
          () => undefined,
          () => undefined,
        ),
      );
      return run;
    },
  };
  Object.defineProperty(globalThis.navigator, "locks", {
    value: locks,
    configurable: true,
    writable: true,
  });
}
installLocksPolyfill();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const AUTH_ERROR = { error: { code: "INVALID_ACCESS_TOKEN", message: "Expired." } };
const REUSED_ERROR = { error: { code: "TOKEN_REUSED", message: "Reused." } };

beforeEach(async () => {
  await webPlatform.secureStore.delete("session");
  vi.restoreAllMocks();
});

async function seedTokens(overrides: Partial<Record<string, string>> = {}) {
  await webPlatform.secureStore.set(
    "session",
    JSON.stringify({
      accessToken: "old-access",
      accessTokenExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      refreshToken: "old-refresh",
      deviceId: "device-1",
      ...overrides,
    }),
  );
}

describe("createApiClient refresh", () => {
  it("refreshes once and retries when 5 requests hit a 401 in parallel", async () => {
    await seedTokens();
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/refresh")) {
        refreshCalls += 1;
        return jsonResponse(200, {
          accessToken: "new-access",
          accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          refreshToken: "new-refresh",
        });
      }
      const auth = (init?.headers as Record<string, string>).Authorization;
      if (auth === "Bearer old-access") {
        return jsonResponse(401, AUTH_ERROR);
      }
      return jsonResponse(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createApiClient({ baseUrl: "http://api.test", platform: webPlatform, onSignedOut: vi.fn() });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => client.request<{ ok: boolean }>("GET", "/thing")),
    );

    expect(results.every((r) => r.ok)).toBe(true);
    expect(refreshCalls).toBe(1);

    const stored = await client.getTokens();
    expect(stored?.accessToken).toBe("new-access");
  });

  it("clears the session and calls onSignedOut on TOKEN_REUSED", async () => {
    await seedTokens();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/auth/refresh")) {
        return jsonResponse(401, REUSED_ERROR);
      }
      return jsonResponse(401, AUTH_ERROR);
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSignedOut = vi.fn();
    const client = createApiClient({ baseUrl: "http://api.test", platform: webPlatform, onSignedOut });

    await expect(client.request("GET", "/thing")).rejects.toBeInstanceOf(ApiError);
    expect(onSignedOut).toHaveBeenCalledOnce();
    expect(await client.getTokens()).toBeNull();
  });

  it("reuses tokens another tab already rotated, instead of refreshing again", async () => {
    await seedTokens();
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/refresh")) {
        refreshCalls += 1;
        return jsonResponse(200, {
          accessToken: "new-access",
          accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          refreshToken: "new-refresh",
        });
      }
      const auth = (init?.headers as Record<string, string>).Authorization;
      if (auth === "Bearer new-access") {
        return jsonResponse(200, { ok: true });
      }
      return jsonResponse(401, AUTH_ERROR);
    });
    vi.stubGlobal("fetch", fetchMock);

    // Two "tabs" (two API client instances) share the same secure store.
    const tabA = createApiClient({ baseUrl: "http://api.test", platform: webPlatform, onSignedOut: vi.fn() });
    const tabB = createApiClient({ baseUrl: "http://api.test", platform: webPlatform, onSignedOut: vi.fn() });

    // Both see the same stale access token and hit 401 at the same time.
    const [resultA, resultB] = await Promise.all([
      tabA.request<{ ok: boolean }>("GET", "/thing"),
      tabB.request<{ ok: boolean }>("GET", "/thing"),
    ]);

    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    expect(refreshCalls).toBe(1);
  });

  it("parses a network failure as a NETWORK_ERROR", async () => {
    await seedTokens();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    const client = createApiClient({ baseUrl: "http://api.test", platform: webPlatform, onSignedOut: vi.fn() });
    await expect(client.request("GET", "/thing")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("parses a server error body into an ApiError with its code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(409, { error: { code: "USERNAME_TAKEN", message: "This username is not available." } }),
      ),
    );
    const client = createApiClient({ baseUrl: "http://api.test", platform: webPlatform, onSignedOut: vi.fn() });
    await expect(client.request("POST", "/auth/register", { skipAuth: true })).rejects.toMatchObject({
      status: 409,
      code: "USERNAME_TAKEN",
    });
  });
});
