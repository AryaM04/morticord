// Validate and forward the four voice gateway ops (VOICE_JOIN, VOICE_LEAVE,
// VOICE_STATE, VOICE_SIGNAL). Each function loads permissions, calls
// VoiceService, and sends the right dispatch through the gateway. A
// rejected op throws VoiceError; the gateway handler turns that into a
// VOICE_ERROR sent back to the caller.
import { eq } from "drizzle-orm";
import {
  DispatchEvent,
  hasPermission,
  Permission,
  type VoiceJoinPayload,
  type VoiceSignalPayload,
  type VoiceStatePayload,
} from "@discord-clone/shared";
import type { DbClient } from "../../db/client.js";
import { channels } from "../../db/schema.js";
import { channelPermissions, loadMemberContext } from "../guilds/member-context.js";
import type { GatewayService } from "../gateway/service.js";
import {
  MAX_SIGNAL_PAYLOAD_BYTES,
  VoiceError,
  toVoiceStateUpdate,
  type VoiceService,
  type VoiceState,
} from "./service.js";

export interface VoiceOpsDeps {
  db: DbClient;
  gateway: GatewayService;
  voice: VoiceService;
}

/** Send a VOICE_STATE_UPDATE for `state` to every guild member who can view its channel. */
export async function broadcastVoiceState(deps: Pick<VoiceOpsDeps, "db" | "gateway">, state: VoiceState): Promise<void> {
  const viewers = await deps.gateway.computeChannelViewers(deps.db, state.guildId, state.channelId);
  deps.gateway.toUsers(viewers, DispatchEvent.VOICE_STATE_UPDATE, toVoiceStateUpdate(state));
}

/** Send a VOICE_STATE_UPDATE with a null channelId for `state`, to the viewers of the channel it left. */
export async function broadcastVoiceLeave(deps: Pick<VoiceOpsDeps, "db" | "gateway">, state: VoiceState): Promise<void> {
  const viewers = await deps.gateway.computeChannelViewers(deps.db, state.guildId, state.channelId);
  deps.gateway.toUsers(viewers, DispatchEvent.VOICE_STATE_UPDATE, toVoiceStateUpdate(state, true));
}

async function loadVoiceChannel(db: DbClient, channelId: bigint) {
  const rows = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  const channel = rows[0];
  if (!channel || channel.guildId === null || channel.type !== "voice") {
    throw new VoiceError("NOT_A_VOICE_CHANNEL", "This is not a voice channel.");
  }
  return channel as typeof channel & { guildId: bigint };
}

export async function handleVoiceJoin(
  deps: VoiceOpsDeps,
  userId: bigint,
  deviceId: string,
  payload: VoiceJoinPayload,
): Promise<void> {
  const channelId = BigInt(payload.channelId);
  const channel = await loadVoiceChannel(deps.db, channelId);

  const context = await loadMemberContext(deps.db, channel.guildId, userId);
  if (!context) {
    throw new VoiceError("NO_PERMISSION", "You are not a member of this guild.");
  }
  const permissions = await channelPermissions(deps.db, channelId, context);
  if (!hasPermission(permissions, Permission.VIEW_CHANNEL) || !hasPermission(permissions, Permission.CONNECT)) {
    throw new VoiceError("NO_PERMISSION", "You do not have permission to join this voice channel.");
  }
  const forceMute = !hasPermission(permissions, Permission.SPEAK);

  const { state, previous } = deps.voice.join({
    userId,
    deviceId,
    guildId: channel.guildId,
    channelId,
    selfMute: payload.selfMute,
    selfDeaf: payload.selfDeaf,
    forceMute,
  });

  if (previous) {
    await broadcastVoiceLeave(deps, previous);
  }
  await broadcastVoiceState(deps, state);
}

export async function handleVoiceLeave(deps: VoiceOpsDeps, userId: bigint, deviceId: string): Promise<void> {
  const state = deps.voice.leave(userId, deviceId);
  if (!state) {
    return;
  }
  await broadcastVoiceLeave(deps, state);
}

export async function handleVoiceState(
  deps: VoiceOpsDeps,
  userId: bigint,
  deviceId: string,
  payload: VoiceStatePayload,
): Promise<void> {
  const current = deps.voice.getUserState(userId);
  if (!current || current.deviceId !== deviceId) {
    throw new VoiceError("NOT_IN_VOICE", "You are not in a voice channel.");
  }

  let hasSpeak = true;
  if (payload.selfMute === false) {
    const context = await loadMemberContext(deps.db, current.guildId, userId);
    const permissions = context ? await channelPermissions(deps.db, current.channelId, context) : 0n;
    hasSpeak = hasPermission(permissions, Permission.SPEAK);
  }

  const state = deps.voice.updateState(userId, deviceId, payload, hasSpeak);
  await broadcastVoiceState(deps, state);
}

/** Measure a signal payload the same way it goes over the wire, in UTF-8 bytes. */
function jsonByteSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

export function handleVoiceSignal(
  deps: Pick<VoiceOpsDeps, "gateway" | "voice">,
  userId: bigint,
  deviceId: string,
  payload: VoiceSignalPayload,
): void {
  if (jsonByteSize(payload.payload) > MAX_SIGNAL_PAYLOAD_BYTES) {
    throw new VoiceError("PAYLOAD_TOO_LARGE", "The signaling payload is too large.");
  }
  const channelId = BigInt(payload.channelId);
  const targetUserId = BigInt(payload.targetUserId);
  deps.voice.validateSignal(userId, deviceId, channelId, targetUserId, payload.targetDeviceId);

  deps.gateway.sendToDevice(targetUserId, payload.targetDeviceId, "VOICE_SIGNAL", {
    channelId: payload.channelId,
    fromUserId: userId.toString(),
    fromDeviceId: deviceId,
    payload: payload.payload,
  });
}

/**
 * Remove every voice peer of a channel that is being deleted, and send
 * each one a leave. `viewerIds` must be computed before the delete
 * commits, because deleted channels can no longer answer "who can view
 * this": the caller already has this list, from the CHANNEL_DELETE send.
 */
export function removeChannelVoice(
  deps: Pick<VoiceOpsDeps, "gateway" | "voice">,
  channelId: bigint,
  viewerIds: bigint[],
): void {
  const removed = deps.voice.removeChannel(channelId);
  for (const state of removed) {
    deps.gateway.toUsers(viewerIds, DispatchEvent.VOICE_STATE_UPDATE, toVoiceStateUpdate(state, true));
  }
}

/**
 * Remove every voice peer of `guildId` who no longer has VIEW_CHANNEL and
 * CONNECT in their channel, and broadcast a leave for each. Call this
 * after any change to guild membership or permissions: a leave, a kick, a
 * ban, or (in M5) a role or overwrite edit.
 */
export async function revalidateGuildVoice(deps: VoiceOpsDeps, guildId: bigint): Promise<void> {
  const removed = await deps.voice.revalidate(guildId, async (state) => {
    const context = await loadMemberContext(deps.db, guildId, state.userId);
    if (!context) {
      return false;
    }
    const permissions = await channelPermissions(deps.db, state.channelId, context);
    return hasPermission(permissions, Permission.VIEW_CHANNEL) && hasPermission(permissions, Permission.CONNECT);
  });
  for (const state of removed) {
    await broadcastVoiceLeave(deps, state);
  }
}
