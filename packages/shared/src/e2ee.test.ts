import { describe, expect, it } from "vitest";
import { canonicalJson, deviceKeysSignedText } from "./e2ee.js";
import { sendToDeviceRequestSchema, uploadKeysRequestSchema } from "./api/keys.js";

describe("canonicalJson", () => {
  it("sorts keys at every level and removes white space", () => {
    expect(canonicalJson({ b: 1, a: { d: [true, null], c: "x" } })).toBe('{"a":{"c":"x","d":[true,null]},"b":1}');
  });

  it("gives the same text for the same object in a different key order", () => {
    expect(deviceKeysSignedText("1", "dev", "c", "e")).toBe(
      canonicalJson({ ed25519: "e", curve25519: "c", deviceId: "dev", userId: "1", type: "device_keys" }),
    );
  });

  it("escapes strings as JSON does", () => {
    expect(canonicalJson({ "k\"": "a\nbé" })).toBe('{"k\\"":"a\\nbé"}');
  });

  it("rejects values that two sides could encode in different ways", () => {
    expect(() => canonicalJson({ a: 1.5 })).toThrow();
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson({ a: 2 ** 60 })).toThrow();
  });
});

describe("key schemas", () => {
  const key = "A".repeat(43);
  const signature = "B".repeat(86);

  it("accepts a valid upload and rejects a short key", () => {
    expect(uploadKeysRequestSchema.safeParse({ deviceKeys: { curve25519: key, ed25519: key, signature } }).success).toBe(true);
    expect(uploadKeysRequestSchema.safeParse({ deviceKeys: { curve25519: "AAA", ed25519: key, signature } }).success).toBe(false);
  });

  it("limits the size and the count of to-device messages", () => {
    const message = { userId: "1", deviceId: "dev", type: "olm.v1", ciphertext: "A".repeat(87_382) };
    expect(sendToDeviceRequestSchema.safeParse({ messages: [message] }).success).toBe(true);
    expect(sendToDeviceRequestSchema.safeParse({ messages: [{ ...message, ciphertext: "A".repeat(87_383) }] }).success).toBe(false);
    expect(sendToDeviceRequestSchema.safeParse({ messages: Array(101).fill({ ...message, ciphertext: "AA" }) }).success).toBe(false);
  });
});
