// Proves the rate limiter is really wired up on the login route. Every
// other auth test file turns the limiter off, so it can make many
// requests without tripping it.
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { createFakeMailer } from "../../mailer.js";
import { createTestDb, describeWithDb, type TestDb } from "../../../test/db.js";
import { buildTestConfig } from "../../../test/helpers.js";

let testDb: TestDb;
let app: FastifyInstance;

describeWithDb("login rate limit", () => {
  beforeAll(async () => {
    testDb = await createTestDb();
    app = await buildApp({ db: testDb.db, config: buildTestConfig(), mailer: createFakeMailer() });
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  it("answers 429 after 10 login attempts in a minute", async () => {
    const attempt = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "nobody@example.com", password: "wrong-password" },
      });

    const responses = [];
    for (let i = 0; i < 11; i += 1) {
      responses.push(await attempt());
    }

    expect(responses.slice(0, 10).every((response) => response.statusCode === 401)).toBe(true);
    expect(responses[10]!.statusCode).toBe(429);
    expect(responses[10]!.json().error.code).toBe("RATE_LIMITED");
  });
});
