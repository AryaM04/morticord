// Tests for environment parsing in config.ts.
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const validEnv = {
  POSTGRES_HOST: "localhost",
  POSTGRES_DB: "discord_clone",
  POSTGRES_USER: "discord_clone",
  POSTGRES_PASSWORD: "secret",
  JWT_SECRET: "jwt-secret-value-that-is-at-least-32-chars",
  TURN_SECRET: "turn-secret-value",
  TURN_DOMAIN: "localhost",
  SMTP_HOST: "localhost",
  SMTP_FROM: "Discord Clone <no-reply@example.com>",
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

  it("throws a clear error when JWT_SECRET is too short", () => {
    expect(() => loadConfig({ ...validEnv, JWT_SECRET: "too-short" })).toThrow(/JWT_SECRET/);
  });

  it("applies default values for WEB_ORIGIN, DATA_DIR and PUBLIC_API_URL", () => {
    const config = loadConfig(validEnv);
    expect(config.webOrigin).toBe("http://localhost:5173");
    expect(config.dataDir).toBe("./data");
    expect(config.publicApiUrl).toBe("http://localhost:5173");
  });

  it("leaves OAuth providers off when their credentials are not set", () => {
    const config = loadConfig(validEnv);
    expect(config.oauth.github).toBeUndefined();
    expect(config.oauth.google).toBeUndefined();
  });

  it("turns on an OAuth provider once both its credentials are set", () => {
    const config = loadConfig({
      ...validEnv,
      GITHUB_CLIENT_ID: "id",
      GITHUB_CLIENT_SECRET: "secret",
    });
    expect(config.oauth.github).toEqual({ clientId: "id", clientSecret: "secret" });
    expect(config.oauth.google).toBeUndefined();
  });

  it("uses TURN_DOMAIN as the default TURN_PUBLIC_HOST", () => {
    const config = loadConfig(validEnv);
    expect(config.turnPublicHost).toBe("localhost");
    expect(config.turnTlsEnabled).toBe(false);
    expect(config.turnTlsPort).toBe(5349);
  });

  it("uses TURN_PUBLIC_HOST when it is set", () => {
    const config = loadConfig({ ...validEnv, TURN_PUBLIC_HOST: "turn.example.com" });
    expect(config.turnPublicHost).toBe("turn.example.com");
  });

  it("falls back to TURN_DOMAIN when TURN_PUBLIC_HOST is an empty string", () => {
    // A copied .env.example leaves this variable set but empty, not unset.
    const config = loadConfig({ ...validEnv, TURN_PUBLIC_HOST: "" });
    expect(config.turnPublicHost).toBe("localhost");
  });

  it("turns on TURN over TLS only when TURN_TLS_ENABLED is \"true\"", () => {
    const config = loadConfig({ ...validEnv, TURN_TLS_ENABLED: "true", TURN_TLS_PORT: "5350" });
    expect(config.turnTlsEnabled).toBe(true);
    expect(config.turnTlsPort).toBe(5350);
  });
});
