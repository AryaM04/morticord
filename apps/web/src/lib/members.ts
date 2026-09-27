// Look up a guild member's display name and user record from the
// realtime store, for message authors, mentions and typing text.
import type { RealtimeState } from "@discord-clone/client-core";
import type { User } from "@discord-clone/shared";

export function memberUser(state: RealtimeState, guildId: string, userId: string): User | undefined {
  if (userId === state.selfUserId) {
    return state.selfMemberByGuild[guildId]?.user;
  }
  return state.membersByGuild[guildId]?.[userId]?.user;
}

export function displayNameOf(state: RealtimeState, guildId: string, userId: string): string {
  const member =
    userId === state.selfUserId ? state.selfMemberByGuild[guildId] : state.membersByGuild[guildId]?.[userId];
  return member?.nickname ?? member?.user?.displayName ?? userId;
}
