// Tests for the TURN credential builder in turn.ts.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTurnCredentials } from "./turn.js";

describe("createTurnCredentials", () => {
  it("builds a username from the expiry time and the user id", () => {
    const before = Math.floor(Date.now() / 1000);
    const creds = createTurnCredentials("secret", "user-1", 3600);
    const [expiryText, userId] = creds.username.split(":");
    const expiry = Number(expiryText);

    expect(userId).toBe("user-1");
    expect(expiry).toBeGreaterThanOrEqual(before + 3600);
    expect(expiry).toBeLessThanOrEqual(before + 3601);
  });

  it("signs the username with HMAC-SHA1, keyed with the secret", () => {
    const creds = createTurnCredentials("secret", "user-1", 3600);
    const expected = createHmac("sha1", "secret").update(creds.username).digest("base64");

    expect(creds.credential).toBe(expected);
  });

  it("returns a different credential for a different secret", () => {
    const credsA = createTurnCredentials("secret-a", "user-1", 3600);
    const credsB = createTurnCredentials("secret-b", "user-1", 3600);

    expect(credsA.credential).not.toBe(credsB.credential);
  });

  it("returns a different username for a different user id", () => {
    const credsA = createTurnCredentials("secret", "user-1", 3600);
    const credsB = createTurnCredentials("secret", "user-2", 3600);

    expect(credsA.username).not.toBe(credsB.username);
  });
});
