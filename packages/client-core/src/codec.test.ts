import { describe, expect, it } from "vitest";
import { encodeBase64Url, type EventJson } from "@discord-clone/shared";
import { plainCodec } from "./codec.js";

function baseEvent(overrides: Partial<EventJson> = {}): EventJson {
  return {
    id: "1",
    channelId: "10",
    senderId: "20",
    senderDeviceId: "device-1",
    relType: null,
    relatesToId: null,
    codec: "plain-v1",
    megolmSessionId: null,
    ciphertext: "",
    nonce: "n1",
    createdAt: new Date().toISOString(),
    redactedAt: null,
    ...overrides,
  };
}

describe("plainCodec", () => {
  it("round-trips a message payload", async () => {
    const encoded = await plainCodec.encode("10", { type: "message", body: "hi", mentions: [], attachments: [], embeds: [] });
    expect(encoded.codec).toBe("plain-v1");
    expect(encoded.megolmSessionId).toBeNull();

    const event = baseEvent({ ciphertext: encodeBase64Url(encoded.ciphertext) });
    const decoded = await plainCodec.decode(event);
    expect(decoded).toEqual({
      ok: true,
      payload: { type: "message", body: "hi", mentions: [], attachments: [], embeds: [] },
    });
  });

  it("reports the message was deleted for a redacted event", async () => {
    const event = baseEvent({ ciphertext: "", redactedAt: new Date().toISOString() });
    const decoded = await plainCodec.decode(event);
    expect(decoded).toEqual({ ok: false, reason: "This message was deleted." });
  });

  it("never throws on garbage ciphertext, and reports it cannot be read", async () => {
    const event = baseEvent({ ciphertext: "not-json-once-decoded" });
    const decoded = await plainCodec.decode(event);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.reason).toBe("This message cannot be read.");
    }
  });

  it("never throws on ciphertext that is not valid base64url", async () => {
    const event = baseEvent({ ciphertext: "!!!not-base64!!!" });
    const decoded = await plainCodec.decode(event);
    expect(decoded).toEqual({ ok: false, reason: "This message cannot be read." });
  });

  it("refuses a codec it does not know, without throwing", async () => {
    const event = baseEvent({ codec: "megolm-v1" });
    const decoded = await plainCodec.decode(event);
    expect(decoded.ok).toBe(false);
  });
});
