// Small shared helpers for integration tests: a full AppConfig with safe
// test defaults, and a fresh temp directory for file storage (avatars).
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/config.js";

export function buildTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    apiPort: 0,
    databaseUrl: "unused-in-tests",
    jwtSecret: "a-test-secret-that-is-at-least-32-characters",
    turnSecret: "test-turn-secret",
    turnDomain: "localhost",
    turnPort: 3478,
    turnPublicHost: "localhost",
    turnTlsEnabled: false,
    turnTlsPort: 5349,
    webOrigin: "http://localhost:5173",
    corsAllowedOrigins: [],
    desktopUrlScheme: "discordclone",
    dataDir: "./data-test",
    smtp: { host: "localhost", port: 1025, from: "Test <no-reply@example.com>" },
    oauth: {},
    publicApiUrl: "http://localhost:5173",
    authRateLimit: {
      register: 10,
      login: 10,
      refresh: 30,
      resendVerification: 5,
      forgotPassword: 10,
      emailLink: 10,
      oauth: 30,
      loginFailuresPerAccount: 10,
    },
    allowPlaintextEvents: false,
    maxAttachmentBytes: 25 * 1024 * 1024,
    attachmentQuotaBytes: 2 * 1024 * 1024 * 1024,
    linkPreviewTestAllowLoopback: false,
    ...overrides,
  };
}

export async function mkTempDataDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "discord-clone-test-"));
}
