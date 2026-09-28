// Voice: the TURN credentials REST response, and the voice-state shape
// shared between REST (GUILD_CREATE, READY) and the gateway
// (VOICE_STATE_UPDATE). See docs/concepts/voice.md for the full design.
import { z } from "zod";
import { idSchema } from "./common.js";

export const iceServerSchema = z.object({
  urls: z.array(z.string()),
  username: z.string().optional(),
  credential: z.string().optional(),
});
export type IceServer = z.infer<typeof iceServerSchema>;

export const turnCredentialsResponseSchema = z.object({
  iceServers: z.array(iceServerSchema),
  ttlSeconds: z.number().int().positive(),
});
export type TurnCredentialsResponse = z.infer<typeof turnCredentialsResponseSchema>;

/**
 * One user's voice state in one channel. A null `channelId` means the user
 * left voice; the server sends this shape to say so, instead of a separate
 * event type.
 */
export const voiceStateSchema = z.object({
  guildId: idSchema,
  channelId: idSchema.nullable(),
  userId: idSchema,
  deviceId: z.string().min(1),
  selfMute: z.boolean(),
  selfDeaf: z.boolean(),
  selfVideo: z.boolean(),
  selfStream: z.boolean(),
  /** Set by a moderator with MUTE_MEMBERS. A server-muted peer cannot self-unmute. */
  serverMute: z.boolean(),
  /** Set by a moderator with DEAFEN_MEMBERS. */
  serverDeaf: z.boolean(),
  joinedAt: z.string(),
});
export type VoiceStateJson = z.infer<typeof voiceStateSchema>;
