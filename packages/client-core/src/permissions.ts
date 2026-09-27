// Compute the signed-in user's own permissions from realtime-store data,
// with the shared `computePermissions`. No REST call is needed: READY,
// GUILD_CREATE and CHANNEL_* dispatches all carry what this needs,
// including each channel's permission overwrites.
import { computePermissions, type OverwriteInput, type RoleInput } from "@discord-clone/shared";
import type { RealtimeState } from "./realtime-store.js";

function memberContext(
  state: RealtimeState,
  guildId: string,
): { isOwner: boolean; everyoneRole: RoleInput; memberRoles: RoleInput[]; memberId: bigint } | null {
  const guild = state.guilds[guildId];
  const member = state.selfMemberByGuild[guildId];
  const roles = state.rolesByGuild[guildId];
  if (!guild || !member || !roles || !state.selfUserId) {
    return null;
  }
  const everyoneRoleJson = roles.find((role) => role.id === guildId);
  if (!everyoneRoleJson) {
    return null;
  }
  const heldRoleIds = new Set(member.roles);
  const memberRoles: RoleInput[] = roles
    .filter((role) => role.id !== guildId && heldRoleIds.has(role.id))
    .map((role) => ({ id: BigInt(role.id), permissions: BigInt(role.permissions) }));

  return {
    isOwner: guild.ownerId === state.selfUserId,
    everyoneRole: { id: BigInt(everyoneRoleJson.id), permissions: BigInt(everyoneRoleJson.permissions) },
    memberRoles,
    memberId: BigInt(state.selfUserId),
  };
}

/** The caller's guild-level permissions: no channel overwrites apply. */
export function selfGuildPermissions(state: RealtimeState, guildId: string): bigint {
  const context = memberContext(state, guildId);
  if (!context) {
    return 0n;
  }
  return computePermissions({ ...context, overwrites: [] });
}

/** The caller's permissions in one channel, including its overwrites. */
export function selfChannelPermissions(state: RealtimeState, channelId: string): bigint {
  const channel = state.channels[channelId];
  if (!channel) {
    return 0n;
  }
  const context = memberContext(state, channel.guildId);
  if (!context) {
    return 0n;
  }
  const overwrites: OverwriteInput[] = channel.permissionOverwrites.map((overwrite) => ({
    targetId: BigInt(overwrite.targetId),
    targetType: overwrite.targetType,
    allow: BigInt(overwrite.allow),
    deny: BigInt(overwrite.deny),
  }));
  return computePermissions({ ...context, overwrites });
}
