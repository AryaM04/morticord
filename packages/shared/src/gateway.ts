// Gateway protocol types: opcodes and message envelope schemas.
// The gateway is a WebSocket connection. Every message is one JSON envelope:
//   { op, t?, s?, d }
// "op" says what kind of message it is. "t" names a dispatch event.
// "s" is a sequence number, used to resume after a disconnect.
// "d" is the payload, and its shape depends on "op" and "t".

import { z } from "zod";

export const GatewayOpcode = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 3,
  HELLO: 4,
  HEARTBEAT_ACK: 5,
  VOICE_JOIN: 6,
  VOICE_LEAVE: 7,
  VOICE_STATE: 8,
  TO_DEVICE_SEND: 9,
  TYPING: 10,
  PRESENCE_SET: 11,
} as const;

export type GatewayOpcodeValue = (typeof GatewayOpcode)[keyof typeof GatewayOpcode];

export const gatewayEnvelopeSchema = z.object({
  op: z.number().int(),
  t: z.string().optional(),
  s: z.number().int().optional(),
  d: z.unknown(),
});

export type GatewayEnvelope = z.infer<typeof gatewayEnvelopeSchema>;

/** Sent by the server right after the connection opens. */
export const helloPayloadSchema = z.object({
  heartbeatIntervalMs: z.number().int().positive(),
});

/** Sent by the client to log in on this connection. */
export const identifyPayloadSchema = z.object({
  accessToken: z.string().min(1),
  deviceId: z.string().min(1),
});

/** Sent by the client to resume a dropped connection without a full reload. */
export const resumePayloadSchema = z.object({
  accessToken: z.string().min(1),
  sessionId: z.string().min(1),
  lastSequence: z.number().int().nonnegative(),
});

/** Sent by the server once IDENTIFY or RESUME succeeds. This is a skeleton for now. */
export const readyPayloadSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().min(1),
  guilds: z.array(z.unknown()).default([]),
});

export type HelloPayload = z.infer<typeof helloPayloadSchema>;
export type IdentifyPayload = z.infer<typeof identifyPayloadSchema>;
export type ResumePayload = z.infer<typeof resumePayloadSchema>;
export type ReadyPayload = z.infer<typeof readyPayloadSchema>;
