// Integration tests for the users routes.
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { createFakeMailer } from "../../mailer.js";
import { createTestDb, describeWithDb, type TestDb } from "../../../test/db.js";
import { buildTestConfig, mkTempDataDir } from "../../../test/helpers.js";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

let testDb: TestDb;
let app: FastifyInstance;

async function registerUser(email: string, username: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, username, password: "correct-password" },
  });
  return response.json() as { accessToken: string; user: { id: string } };
}

describeWithDb("users routes", () => {
  beforeAll(async () => {
    testDb = await createTestDb();
    const dataDir = await mkTempDataDir();
    app = await buildApp({
      db: testDb.db,
      config: buildTestConfig({ dataDir }),
      mailer: createFakeMailer(),
      rateLimit: false,
    });
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  it("returns the signed-in user's own profile, with the email", async () => {
    const { accessToken } = await registerUser("pat@example.com", "pat");
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/users/@me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.username).toBe("pat");
    expect(body.email).toBe("pat@example.com");
  });

  it("rejects @me without a bearer token", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/users/@me" });
    expect(response.statusCode).toBe(401);
  });

  it("updates the display name and status text", async () => {
    const { accessToken } = await registerUser("quinn@example.com", "quinn");
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/users/@me",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { displayName: "Quinn Q", statusText: "Busy" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.displayName).toBe("Quinn Q");
    expect(body.statusText).toBe("Busy");
  });

  it("rejects a display name that is too long", async () => {
    const { accessToken } = await registerUser("riley@example.com", "riley");
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/users/@me",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { displayName: "x".repeat(40) },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_INPUT");
  });

  it("uploads an avatar and serves it back at the public URL", async () => {
    const { accessToken } = await registerUser("sam@example.com", "sam");

    const uploadResponse = await app.inject({
      method: "PUT",
      url: "/api/v1/users/@me/avatar",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "image/png" },
      payload: PNG_BYTES,
    });
    expect(uploadResponse.statusCode).toBe(200);
    const user = uploadResponse.json();
    expect(typeof user.avatarKey).toBe("string");

    const fetchResponse = await app.inject({
      method: "GET",
      url: `/api/v1/avatars/${user.id}/${user.avatarKey}`,
    });
    expect(fetchResponse.statusCode).toBe(200);
    expect(fetchResponse.headers["content-type"]).toBe("image/png");
    expect(fetchResponse.headers["cache-control"]).toContain("immutable");
    expect(fetchResponse.rawPayload.equals(PNG_BYTES)).toBe(true);
  });

  it("rejects an avatar upload whose bytes are not really an image", async () => {
    const { accessToken } = await registerUser("tara@example.com", "tara");
    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/users/@me/avatar",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "image/png" },
      payload: Buffer.from("not an image, just text", "utf8"),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_IMAGE");
  });

  it("rejects an avatar upload over 1 MiB", async () => {
    const { accessToken } = await registerUser("uma@example.com", "uma");
    const tooBig = Buffer.concat([PNG_BYTES, Buffer.alloc(1024 * 1024)]);
    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/users/@me/avatar",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "image/png" },
      payload: tooBig,
    });
    expect(response.statusCode).toBe(413);
  });

  it("removes the avatar and it is not found afterward", async () => {
    const { accessToken } = await registerUser("vince@example.com", "vince");
    const uploadResponse = await app.inject({
      method: "PUT",
      url: "/api/v1/users/@me/avatar",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "image/png" },
      payload: PNG_BYTES,
    });
    const uploaded = uploadResponse.json();

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/api/v1/users/@me/avatar",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json().avatarKey).toBeNull();

    const fetchResponse = await app.inject({
      method: "GET",
      url: `/api/v1/avatars/${uploaded.id}/${uploaded.avatarKey}`,
    });
    expect(fetchResponse.statusCode).toBe(404);
  });

  it("returns 404 for a wrong avatar key", async () => {
    const { accessToken } = await registerUser("wendy@example.com", "wendy");
    const uploadResponse = await app.inject({
      method: "PUT",
      url: "/api/v1/users/@me/avatar",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "image/png" },
      payload: PNG_BYTES,
    });
    const uploaded = uploadResponse.json();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/avatars/${uploaded.id}/wrong-key`,
    });
    expect(response.statusCode).toBe(404);
  });
});
