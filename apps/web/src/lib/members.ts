// Look up a guild member's display name and user record from the
// realtime store, for message authors, mentions and typing text.
import type { RealtimeState } from "@discord-clone/client-core";
import type { User } from "@discord-clone/shared";
import { session } from "./session.js";

/** The signed-in user's own profile. The session keeps it even before a member row loads. */
function selfUser(state: RealtimeState, guildId: string): User | undefined {
  return state.selfMemberByGuild[guildId]?.user ?? session.store.getState().user ?? undefined;
}

export function memberUser(state: RealtimeState, guildId: string, userId: string): User | undefined {
  if (userId === state.selfUserId) {
    return selfUser(state, guildId);
  }
  return state.membersByGuild[guildId]?.[userId]?.user;
}

export function displayNameOf(state: RealtimeState, guildId: string, userId: string): string {
  const member =
    userId === state.selfUserId ? state.selfMemberByGuild[guildId] : state.membersByGuild[guildId]?.[userId];
  return member?.nickname ?? memberUser(state, guildId, userId)?.displayName ?? userId;
}
