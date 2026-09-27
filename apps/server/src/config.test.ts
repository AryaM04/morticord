// Tests for environment parsing in config.ts.
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const validEnv = {
  POSTGRES_HOST: "localhost",
  POSTGRES_DB: "discord_clone",
  POSTGRES_USER: "discord_clone",
  POSTGRES_PASSWORD: "secret",
  JWT_SECRET: "jwt-secret-value",
  TURN_SECRET: "turn-secret-value",
  TURN_DOMAIN: "localhost",
};

describe("loadConfig", () => {
  it("builds a database URL from the Postgres parts", () => {
    const config = loadConfig(validEnv);
    expect(config.databaseUrl).toBe(
      "postgres://discord_clone:secret@localhost:5432/discord_clone",
    );
  });

  it("applies the default API port when it is not set", () => {
    const config = loadConfig(validEnv);
    expect(config.apiPort).toBe(3000);
  });

  it("uses a custom API port when it is set", () => {
    const config = loadConfig({ ...validEnv, API_PORT: "4000" });
    expect(config.apiPort).toBe(4000);
  });

  it("throws a clear error when a required value is missing", () => {
    const { POSTGRES_PASSWORD: _unused, ...rest } = validEnv;
    expect(() => loadConfig(rest)).toThrow(/POSTGRES_PASSWORD/);
  });
});
