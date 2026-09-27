// Request, response and payload schemas for channel events (messages,
// edits and reactions).
//
// The server stores an opaque `ciphertext` per event and plaintext routing
// metadata only (channel, sender, relation, codec, times). It never parses
// the bytes inside `ciphertext`. In milestone M3 the client uses the
// "plaintext codec" (`plain-v1`): the decrypted payload schemas below are
// JSON, encoded to bytes with `encodePlainPayload`. From milestone M6 the
// bytes are Megolm ciphertext instead, and the server code does not change,
// because it only ever sees opaque bytes either way.
import { z } from "zod";
import { decodeBase64Url, encodeBase64Url } from "../base64.js";
import { idSchema } from "./common.js";

export const MAX_MESSAGE_BODY_LENGTH = 4000;
export const MAX_MENTIONS = 50;
export const MAX_REACTION_KEY_LENGTH = 32;
export const MAX_CIPHERTEXT_BYTES = 16 * 1024;
export const MAX_NONCE_LENGTH = 64;

// ---- the decrypted payload (client-only; the server never parses this) ----

const mentionsSchema = z.array(idSchema).max(MAX_MENTIONS);

export const messagePayloadSchema = z.object({
  type: z.literal("message"),
  body: z.string().max(MAX_MESSAGE_BODY_LENGTH),
  mentions: mentionsSchema.default([]),
  /** Filled in from milestone M6. Always empty in the plaintext codec. */
  attachments: z.array(z.never()).default([]),
  /** Filled in from milestone M6. Always empty in the plaintext codec. */
  embeds: z.array(z.never()).default([]),
});
export type MessagePayload = z.infer<typeof messagePayloadSchema>;

export const editPayloadSchema = z.object({
  type: z.literal("edit"),
  body: z.string().max(MAX_MESSAGE_BODY_LENGTH),
  mentions: mentionsSchema.default([]),
});
export type EditPayload = z.infer<typeof editPayloadSchema>;

export const reactionPayloadSchema = z.object({
  type: z.literal("reaction"),
  key: z.string().min(1).max(MAX_REACTION_KEY_LENGTH),
});
export type ReactionPayload = z.infer<typeof reactionPayloadSchema>;

/**
 * The decrypted payload of one event, discriminated on `type`. A `message`
 * needs a non-empty body unless it carries an attachment.
 */
export const decryptedPayloadSchema = z
  .discriminatedUnion("type", [messagePayloadSchema, editPayloadSchema, reactionPayloadSchema])
  .superRefine((value, ctx) => {
    if (value.type === "message" && value.body.length === 0 && value.attachments.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A message needs a body, unless it has an attachment.",
        path: ["body"],
      });
    }
  });
export type DecryptedPayload = z.infer<typeof decryptedPayloadSchema>;

/** Encode a decrypted payload to bytes, for the plaintext codec (`plain-v1`). */
export function encodePlainPayload(payload: DecryptedPayload): Uint8Array {
  const validated = decryptedPayloadSchema.parse(payload);
  return new TextEncoder().encode(JSON.stringify(validated));
}

/** Decode bytes back to a decrypted payload, for the plaintext codec (`plain-v1`). */
export function decodePlainPayload(bytes: Uint8Array): DecryptedPayload {
  const text = new TextDecoder().decode(bytes);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("The plaintext codec payload is not valid JSON.");
  }
  return decryptedPayloadSchema.parse(json);
}

// ---- wire event shape (server + client) ----

export const eventCodecSchema = z.enum(["plain-v1", "megolm-v1"]);
export type EventCodec = z.infer<typeof eventCodecSchema>;

export const eventRelTypeSchema = z.enum(["reply", "edit", "reaction"]);
export type EventRelType = z.infer<typeof eventRelTypeSchema>;

export const base64UrlSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]*$/, "This is not valid base64url text.");

/** Base64url ciphertext, at most `MAX_CIPHERTEXT_BYTES` bytes once decoded. */
export const ciphertextSchema = base64UrlSchema.refine(
  (value) => {
    try {
      return decodeBase64Url(value).length <= MAX_CIPHERTEXT_BYTES;
    } catch {
      return false;
    }
  },
  `The ciphertext must be at most ${MAX_CIPHERTEXT_BYTES} bytes once decoded.`,
);

export const eventSchema = z.object({
  id: idSchema,
  channelId: idSchema,
  senderId: idSchema,
  senderDeviceId: z.string(),
  relType: eventRelTypeSchema.nullable(),
  relatesToId: idSchema.nullable(),
  codec: eventCodecSchema,
  megolmSessionId: z.string().nullable(),
  /** Base64url ciphertext. Empty when the event is redacted. */
  ciphertext: z.string(),
  createdAt: z.string(),
  redactedAt: z.string().nullable(),
});
export type EventJson = z.infer<typeof eventSchema>;

// ---- REST: POST /channels/:id/events ----

export const createEventRequestSchema = z
  .object({
    relType: eventRelTypeSchema.optional(),
    relatesToId: idSchema.optional(),
    codec: eventCodecSchema,
    megolmSessionId: z.string().optional(),
    ciphertext: ciphertextSchema,
    nonce: z.string().min(1).max(MAX_NONCE_LENGTH),
  })
  .refine((value) => value.relType === undefined || value.relatesToId !== undefined, {
    message: "relatesToId is required when relType is set.",
    path: ["relatesToId"],
  });
export type CreateEventRequest = z.infer<typeof createEventRequestSchema>;

// ---- REST: GET /channels/:id/events ----

export const listEventsQuerySchema = z
  .object({
    before: idSchema.optional(),
    after: idSchema.optional(),
    around: idSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((value) => [value.before, value.after, value.around].filter((v) => v !== undefined).length <= 1, {
    message: "Use at most one of before, after or around.",
  });
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;

export const listEventsResponseSchema = z.object({
  /** Timeline events (relType null or reply) for the requested page, ascending by id. */
  events: z.array(eventSchema),
  /** Non-redacted edit/reaction events whose relatesToId is one of the page's event ids. */
  relations: z.array(eventSchema),
  hasMoreBefore: z.boolean(),
  hasMoreAfter: z.boolean(),
});
export type ListEventsResponse = z.infer<typeof listEventsResponseSchema>;

// ---- REST: PUT /channels/:id/read ----

export const updateReadStateRequestSchema = z.object({
  eventId: idSchema,
});
export type UpdateReadStateRequest = z.infer<typeof updateReadStateRequestSchema>;

export const readStateSchema = z.object({
  channelId: idSchema,
  lastReadEventId: idSchema.nullable(),
});
export type ReadStateJson = z.infer<typeof readStateSchema>;

// ---- re-export for convenience ----
export { decodeBase64Url, encodeBase64Url };
