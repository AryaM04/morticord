import { describe, expect, it } from "vitest";
import { encodeBase64Url } from "../base64.js";
import {
  ciphertextSchema,
  createEventRequestSchema,
  decodePlainPayload,
  decryptedPayloadSchema,
  encodePlainPayload,
  MAX_CIPHERTEXT_BYTES,
} from "./messages.js";

describe("decryptedPayloadSchema", () => {
  it("accepts a message with a non-empty body", () => {
    const result = decryptedPayloadSchema.safeParse({ type: "message", body: "hi", mentions: [], attachments: [], embeds: [] });
    expect(result.success).toBe(true);
  });

  it("rejects a message with an empty body and no attachments", () => {
    const result = decryptedPayloadSchema.safeParse({ type: "message", body: "", mentions: [], attachments: [], embeds: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a reaction key longer than 32 characters", () => {
    const result = decryptedPayloadSchema.safeParse({ type: "reaction", key: "x".repeat(33) });
    expect(result.success).toBe(false);
  });

  it("rejects more than 50 mentions", () => {
    const mentions = Array.from({ length: 51 }, (_, i) => String(i + 1));
    const result = decryptedPayloadSchema.safeParse({ type: "message", body: "hi", mentions, attachments: [], embeds: [] });
    expect(result.success).toBe(false);
  });
});

describe("encodePlainPayload / decodePlainPayload", () => {
  it("round-trips a message payload", () => {
    const payload = { type: "message" as const, body: "hello", mentions: ["1", "2"], attachments: [], embeds: [] };
    const bytes = encodePlainPayload(payload);
    expect(decodePlainPayload(bytes)).toEqual(payload);
  });

  it("throws on bytes that are not valid JSON", () => {
    expect(() => decodePlainPayload(new TextEncoder().encode("not json"))).toThrow();
  });

  it("throws on JSON that does not match the payload schema", () => {
    expect(() => decodePlainPayload(new TextEncoder().encode(JSON.stringify({ type: "unknown" })))).toThrow();
  });
});

describe("ciphertextSchema", () => {
  it("accepts ciphertext at exactly the byte limit", () => {
    const text = encodeBase64Url(new Uint8Array(MAX_CIPHERTEXT_BYTES));
    expect(ciphertextSchema.safeParse(text).success).toBe(true);
  });

  it("rejects ciphertext over the byte limit", () => {
    const text = encodeBase64Url(new Uint8Array(MAX_CIPHERTEXT_BYTES + 1));
    expect(ciphertextSchema.safeParse(text).success).toBe(false);
  });

  it("rejects text outside the base64url alphabet", () => {
    expect(ciphertextSchema.safeParse("not valid!").success).toBe(false);
  });
});

describe("createEventRequestSchema", () => {
  const ciphertext = encodeBase64Url(new TextEncoder().encode("x"));

  it("accepts a plain message with no relation", () => {
    const result = createEventRequestSchema.safeParse({ codec: "plain-v1", ciphertext, nonce: "abc" });
    expect(result.success).toBe(true);
  });

  it("requires relatesToId when relType is set", () => {
    const result = createEventRequestSchema.safeParse({ relType: "reaction", codec: "plain-v1", ciphertext, nonce: "abc" });
    expect(result.success).toBe(false);
  });

  it("accepts a reaction with a target", () => {
    const result = createEventRequestSchema.safeParse({
      relType: "reaction",
      relatesToId: "123",
      codec: "plain-v1",
      ciphertext,
      nonce: "abc",
    });
    expect(result.success).toBe(true);
  });
});
