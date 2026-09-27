// The realtime store: everything the gateway keeps up to date live
// (guilds, channels, roles, members, presence). `applyDispatch` is a
// pure reducer, so it is easy to test on its own; `createRealtimeStore`
// wraps it in a vanilla zustand store for the app to read and subscribe to.
import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  ChannelJson,
  GuildJson,
  GuildMemberJson,
  RoleJson,
  VisiblePresenceStatus,
} from "@discord-clone/shared";
import type { GatewayDispatch } from "./gateway.js";

export interface RealtimeState {
  selfUserId: string | null;
  guilds: Record<string, GuildJson>;
  channels: Record<string, ChannelJson>;
  /** Channel ids per guild, ordered by position then id. */
  channelIdsByGuild: Record<string, string[]>;
  rolesByGuild: Record<string, RoleJson[]>;
  /** The signed-in user's own member row in each guild they are in. */
  selfMemberByGuild: Record<string, GuildMemberJson>;
  /** Other members, loaded a page at a time over REST and kept live by events. */
  membersByGuild: Record<string, Record<string, GuildMemberJson>>;
  presences: Record<string, VisiblePresenceStatus>;
}

export function createInitialRealtimeState(): RealtimeState {
  return {
    selfUserId: null,
    guilds: {},
    channels: {},
    channelIdsByGuild: {},
    rolesByGuild: {},
    selfMemberByGuild: {},
    membersByGuild: {},
    presences: {},
  };
}

function compareChannelIds(channels: Record<string, ChannelJson>) {
  return (a: string, b: string): number => {
    const posA = channels[a]?.position ?? 0;
    const posB = channels[b]?.position ?? 0;
    if (posA !== posB) {
      return posA - posB;
    }
    // Same position: break the tie by id, oldest first. Ids are decimal
    // snowflakes, so compare as bigint, not as text.
    const idA = BigInt(a);
    const idB = BigInt(b);
    return idA < idB ? -1 : idA > idB ? 1 : 0;
  };
}

function withSortedChannelIds(channels: Record<string, ChannelJson>, ids: string[]): string[] {
  return [...ids].sort(compareChannelIds(channels));
}

function without<T extends Record<string, unknown>>(record: T, key: string): T {
  if (!(key in record)) {
    return record;
  }
  const next = { ...record };
  delete next[key];
  return next;
}

/**
 * Apply one gateway dispatch to the realtime state, returning a new
 * state. Never mutates its input. Unknown guild ids (an event for a
 * guild this client has not loaded) are ignored rather than crashing.
 */
export function applyDispatch(state: RealtimeState, event: GatewayDispatch): RealtimeState {
  switch (event.t) {
    case "READY": {
      const payload = event.d as {
        user: { id: string };
        guilds: Array<GuildJson & { roles: RoleJson[]; channels: ChannelJson[]; member: GuildMemberJson }>;
        presences: Array<{ userId: string; status: VisiblePresenceStatus }>;
      };
      const next = createInitialRealtimeState();
      next.selfUserId = payload.user.id;
      for (const guild of payload.guilds) {
        next.guilds[guild.id] = { id: guild.id, name: guild.name, iconKey: guild.iconKey, ownerId: guild.ownerId, createdAt: guild.createdAt };
        next.rolesByGuild[guild.id] = guild.roles;
        next.selfMemberByGuild[guild.id] = guild.member;
        const ids: string[] = [];
        for (const channel of guild.channels) {
          next.channels[channel.id] = channel;
          ids.push(channel.id);
        }
        next.channelIdsByGuild[guild.id] = withSortedChannelIds(next.channels, ids);
      }
      for (const presence of payload.presences) {
        next.presences[presence.userId] = presence.status;
      }
      return next;
    }

    case "RESUMED":
      return state;

    case "GUILD_CREATE": {
      const guild = event.d as GuildJson & { roles: RoleJson[]; channels: ChannelJson[]; member: GuildMemberJson };
      const channels = { ...state.channels };
      const ids: string[] = [];
      for (const channel of guild.channels) {
        channels[channel.id] = channel;
        ids.push(channel.id);
      }
      return {
        ...state,
        guilds: { ...state.guilds, [guild.id]: { id: guild.id, name: guild.name, iconKey: guild.iconKey, ownerId: guild.ownerId, createdAt: guild.createdAt } },
        rolesByGuild: { ...state.rolesByGuild, [guild.id]: guild.roles },
        selfMemberByGuild: { ...state.selfMemberByGuild, [guild.id]: guild.member },
        channels,
        channelIdsByGuild: { ...state.channelIdsByGuild, [guild.id]: withSortedChannelIds(channels, ids) },
      };
    }

    case "GUILD_UPDATE": {
      const patch = event.d as GuildJson;
      if (!(patch.id in state.guilds)) {
        return state;
      }
      return { ...state, guilds: { ...state.guilds, [patch.id]: { ...state.guilds[patch.id], ...patch } } };
    }

    case "GUILD_DELETE": {
      const { id } = event.d as { id: string };
      if (!(id in state.guilds)) {
        return state;
      }
      const channelIds = state.channelIdsByGuild[id] ?? [];
      const channels = { ...state.channels };
      for (const channelId of channelIds) {
        delete channels[channelId];
      }
      return {
        ...state,
        guilds: without(state.guilds, id),
        rolesByGuild: without(state.rolesByGuild, id),
        selfMemberByGuild: without(state.selfMemberByGuild, id),
        membersByGuild: without(state.membersByGuild, id),
        channelIdsByGuild: without(state.channelIdsByGuild, id),
        channels,
      };
    }

    case "CHANNEL_CREATE":
    case "CHANNEL_UPDATE": {
      const channel = event.d as ChannelJson;
      if (!(channel.guildId in state.guilds)) {
        return state;
      }
      const channels = { ...state.channels, [channel.id]: channel };
      const existingIds = state.channelIdsByGuild[channel.guildId] ?? [];
      const ids = existingIds.includes(channel.id) ? existingIds : [...existingIds, channel.id];
      return {
        ...state,
        channels,
        channelIdsByGuild: { ...state.channelIdsByGuild, [channel.guildId]: withSortedChannelIds(channels, ids) },
      };
    }

    case "CHANNEL_DELETE": {
      const { id, guildId } = event.d as { id: string; guildId: string };
      if (!(guildId in state.guilds) || !(id in state.channels)) {
        return state;
      }
      const ids = (state.channelIdsByGuild[guildId] ?? []).filter((channelId) => channelId !== id);
      return {
        ...state,
        channels: without(state.channels, id),
        channelIdsByGuild: { ...state.channelIdsByGuild, [guildId]: ids },
      };
    }

    case "GUILD_MEMBER_ADD":
    case "GUILD_MEMBER_UPDATE": {
      const member = event.d as GuildMemberJson;
      if (!(member.guildId in state.guilds)) {
        return state;
      }
      const guildMembers = { ...(state.membersByGuild[member.guildId] ?? {}), [member.userId]: member };
      return { ...state, membersByGuild: { ...state.membersByGuild, [member.guildId]: guildMembers } };
    }

    case "GUILD_MEMBER_REMOVE": {
      const { guildId, userId } = event.d as { guildId: string; userId: string };
      const guildMembers = state.membersByGuild[guildId];
      if (!guildMembers || !(userId in guildMembers)) {
        return state;
      }
      return {
        ...state,
        membersByGuild: { ...state.membersByGuild, [guildId]: without(guildMembers, userId) },
      };
    }

    case "PRESENCE_UPDATE": {
      const { userId, status } = event.d as { userId: string; status: VisiblePresenceStatus };
      return { ...state, presences: { ...state.presences, [userId]: status } };
    }

    default:
      return state;
  }
}

export interface RealtimeActions {
  applyDispatch(event: GatewayDispatch): void;
  /** Merge one REST-loaded page of members into the store. */
  addMemberPage(guildId: string, members: GuildMemberJson[]): void;
  reset(): void;
}

export type RealtimeStore = RealtimeState & RealtimeActions;

export function createRealtimeStore(): StoreApi<RealtimeStore> {
  return createStore<RealtimeStore>((set, get) => ({
    ...createInitialRealtimeState(),

    applyDispatch(event: GatewayDispatch) {
      const current = get();
      const next = applyDispatch(current, event);
      if (next !== current) {
        set(next);
      }
    },

    addMemberPage(guildId: string, members: GuildMemberJson[]) {
      const existing = get().membersByGuild[guildId] ?? {};
      const merged = { ...existing };
      for (const member of members) {
        merged[member.userId] = member;
      }
      set({ membersByGuild: { ...get().membersByGuild, [guildId]: merged } });
    },

    reset() {
      set(createInitialRealtimeState());
    },
  }));
}
