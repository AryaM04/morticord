// Gateway protocol types: opcodes, close codes and message envelope schemas.
// The gateway is a WebSocket connection. Every message is one JSON envelope:
//   { op, t?, s?, d }
// "op" says what kind of message it is. "t" names a dispatch event.
// "s" is a sequence number, used to resume after a disconnect.
// "d" is the payload, and its shape depends on "op" and "t".

import { z } from "zod";
import { guildViewSchema } from "./api/guilds.js";

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
  INVALID_SESSION: 12,
  RECONNECT: 13,
} as const;

export type GatewayOpcodeValue = (typeof GatewayOpcode)[keyof typeof GatewayOpcode];

/**
 * Close codes the gateway uses on `ws.close(code, reason)`. Every one is
 * in the 4000-4999 application range, so it never collides with a
 * protocol-level WebSocket close code.
 */
export const GatewayCloseCode = {
  UNKNOWN_ERROR: 4000,
  UNKNOWN_OPCODE: 4001,
  DECODE_ERROR: 4002,
  NOT_AUTHENTICATED: 4003,
  AUTH_FAILED: 4004,
  ALREADY_AUTHENTICATED: 4005,
  RATE_LIMITED: 4008,
  SESSION_TIMED_OUT: 4009,
  DEVICE_REVOKED: 4010,
} as const;

export type GatewayCloseCodeValue = (typeof GatewayCloseCode)[keyof typeof GatewayCloseCode];

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

/** Sent by the client to report a heartbeat. `s` is the last sequence it saw, or null. */
export const heartbeatPayloadSchema = z.object({
  s: z.number().int().nonnegative().nullable(),
});

/** Sent by the client to set its own presence status. */
export const presenceStatusSchema = z.enum(["online", "idle", "dnd", "invisible"]);
export const presenceSetPayloadSchema = z.object({
  status: presenceStatusSchema,
});

/** The presence the server shows to other users: invisible looks like offline. */
export const visiblePresenceStatusSchema = z.enum(["online", "idle", "dnd", "offline"]);

export const presenceEntrySchema = z.object({
  userId: z.string().min(1),
  status: visiblePresenceStatusSchema,
});

/** Sent by the server once IDENTIFY or RESUME succeeds. */
export const readyPayloadSchema = z.object({
  sessionId: z.string().min(1),
  user: z.object({ id: z.string().min(1) }).passthrough(),
  guilds: z.array(guildViewSchema),
  presences: z.array(presenceEntrySchema),
});

/** Sent by the server after a successful RESUME, once missed dispatches replay. */
export const resumedPayloadSchema = z.object({});

/** Sent by the server when RESUME cannot succeed. The client must IDENTIFY again. */
export const invalidSessionPayloadSchema = z.object({
  canResume: z.literal(false),
});

export const guildDeletePayloadSchema = z.object({ id: z.string().min(1) });
export const channelDeletePayloadSchema = z.object({ id: z.string().min(1), guildId: z.string().min(1) });
export const guildMemberRemovePayloadSchema = z.object({
  guildId: z.string().min(1),
  userId: z.string().min(1),
});
export const presenceUpdatePayloadSchema = presenceEntrySchema;

export type HelloPayload = z.infer<typeof helloPayloadSchema>;
export type IdentifyPayload = z.infer<typeof identifyPayloadSchema>;
export type ResumePayload = z.infer<typeof resumePayloadSchema>;
export type HeartbeatPayload = z.infer<typeof heartbeatPayloadSchema>;
export type PresenceSetPayload = z.infer<typeof presenceSetPayloadSchema>;
export type PresenceStatus = z.infer<typeof presenceStatusSchema>;
export type VisiblePresenceStatus = z.infer<typeof visiblePresenceStatusSchema>;
export type PresenceEntry = z.infer<typeof presenceEntrySchema>;
export type ReadyPayload = z.infer<typeof readyPayloadSchema>;
export type InvalidSessionPayload = z.infer<typeof invalidSessionPayloadSchema>;
export type GuildDeletePayload = z.infer<typeof guildDeletePayloadSchema>;
export type ChannelDeletePayload = z.infer<typeof channelDeletePayloadSchema>;
export type GuildMemberRemovePayload = z.infer<typeof guildMemberRemovePayloadSchema>;
export type PresenceUpdatePayload = z.infer<typeof presenceUpdatePayloadSchema>;

/** Names of every dispatch event ("t" field), for the fan-out code and tests. */
export const DispatchEvent = {
  GUILD_CREATE: "GUILD_CREATE",
  GUILD_UPDATE: "GUILD_UPDATE",
  GUILD_DELETE: "GUILD_DELETE",
  CHANNEL_CREATE: "CHANNEL_CREATE",
  CHANNEL_UPDATE: "CHANNEL_UPDATE",
  CHANNEL_DELETE: "CHANNEL_DELETE",
  GUILD_MEMBER_ADD: "GUILD_MEMBER_ADD",
  GUILD_MEMBER_UPDATE: "GUILD_MEMBER_UPDATE",
  GUILD_MEMBER_REMOVE: "GUILD_MEMBER_REMOVE",
  PRESENCE_UPDATE: "PRESENCE_UPDATE",
} as const;

export type DispatchEventName = (typeof DispatchEvent)[keyof typeof DispatchEvent];
