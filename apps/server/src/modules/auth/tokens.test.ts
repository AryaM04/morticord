// Tests for the token helpers: signing, verifying and expiry.
import { describe, expect, it } from "vitest";
import {
  generateDeviceId,
  generateOpaqueToken,
  hashOpaqueToken,
  signAccessToken,
  verifyAccessToken,
} from "./tokens.js";

const SECRET = "a-test-secret-that-is-at-least-32-characters";

describe("generateDeviceId", () => {
  it("returns 16 base64url characters", () => {
    const id = generateDeviceId();
    expect(id).toHaveLength(16);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns a different value each time", () => {
    expect(generateDeviceId()).not.toBe(generateDeviceId());
  });
});

describe("generateOpaqueToken and hashOpaqueToken", () => {
  it("hashes the same token to the same value", () => {
    const token = generateOpaqueToken();
    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
  });

  it("hashes different tokens to different values", () => {
    expect(hashOpaqueToken(generateOpaqueToken())).not.toBe(hashOpaqueToken(generateOpaqueToken()));
  });
});

describe("signAccessToken and verifyAccessToken", () => {
  it("round-trips the user id and the device id", async () => {
    const userId = 123456789012345678n;
    const deviceId = generateDeviceId();
    const { accessToken } = await signAccessToken(SECRET, { userId, deviceId });

    const claims = await verifyAccessToken(SECRET, accessToken);
    expect(claims.userId).toBe(userId);
    expect(claims.deviceId).toBe(deviceId);
  });

  it("sets an expiry about 15 minutes in the future", async () => {
    const before = Date.now();
    const { accessTokenExpiresAt } = await signAccessToken(SECRET, {
      userId: 1n,
      deviceId: generateDeviceId(),
    });
    const deltaMs = accessTokenExpiresAt.getTime() - before;
    expect(deltaMs).toBeGreaterThan(14 * 60 * 1000);
    expect(deltaMs).toBeLessThanOrEqual(15 * 60 * 1000 + 5000);
  });

  it("rejects a token signed with a different secret", async () => {
    const { accessToken } = await signAccessToken(SECRET, { userId: 1n, deviceId: "device1" });
    await expect(verifyAccessToken("a-different-secret-with-32-plus-chars", accessToken)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    // Sign a token that expired one second ago, by using a helper with a
    // negative TTL is not exposed, so build one by hand with jose directly.
    const { SignJWT } = await import("jose");
    const secretKey = new TextEncoder().encode(SECRET);
    const expiredToken = await new SignJWT({ did: "device1" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("1")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .sign(secretKey);

    await expect(verifyAccessToken(SECRET, expiredToken)).rejects.toThrow();
  });

  it("rejects a malformed token", async () => {
    await expect(verifyAccessToken(SECRET, "not-a-real-token")).rejects.toThrow();
  });
});
