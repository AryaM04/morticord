// The payload codec: turns a decrypted payload into wire bytes, and back.
// In milestone M3 the only codec is `plain-v1` (plain JSON, no encryption).
// From milestone M6 an encrypted codec (`megolm-v1`) implements the same
// interface, so the message store never changes: it is given a codec, and
// it does not know or care which one.
import {
  decodeBase64Url,
  decodePlainPayload,
  encodePlainPayload,
  type DecryptedPayload,
  type EventJson,
} from "@discord-clone/shared";

/** The result of decoding one event's ciphertext back to a payload. */
export type DecodeResult = { ok: true; payload: DecryptedPayload } | { ok: false; reason: string };

/**
 * Turns a decrypted payload into wire bytes for one channel, and turns an
 * event's wire bytes back into a decrypted payload. A payload that fails
 * to decode must return `{ ok: false }`, never throw: the store shows
 * "This message cannot be read." instead of crashing.
 */
export interface PayloadCodec {
  encode(
    channelId: string,
    payload: DecryptedPayload,
  ): Promise<{ codec: string; ciphertext: Uint8Array; megolmSessionId: string | null }>;
  decode(event: EventJson): Promise<DecodeResult>;
}

/** The plaintext codec (`plain-v1`): the payload bytes are plain UTF-8 JSON. */
export const plainCodec: PayloadCodec = {
  async encode(_channelId, payload) {
    return { codec: "plain-v1", ciphertext: encodePlainPayload(payload), megolmSessionId: null };
  },

  async decode(event) {
    if (event.codec !== "plain-v1") {
      return { ok: false, reason: `This client cannot read the "${event.codec}" codec yet.` };
    }
    if (event.redactedAt) {
      return { ok: false, reason: "This message was deleted." };
    }
    try {
      const bytes = decodeBase64Url(event.ciphertext);
      const payload = decodePlainPayload(bytes);
      return { ok: true, payload };
    } catch {
      return { ok: false, reason: "This message cannot be read." };
    }
  },
};
