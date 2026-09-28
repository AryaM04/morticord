// Tests for the pure `applyDispatch` reducer: READY, every guild/channel/
// member/presence dispatch, unknown-guild events, deletes of selected
// items, and channel ordering by position then id.
import { describe, expect, it } from "vitest";
import { applyDispatch, createInitialRealtimeState, type RealtimeState } from "./realtime-store.js";

function role(id: string, guildId: string) {
  return {
    id,
    guildId,
    name: "@everyone",
    color: 0,
    position: 0,
    permissions: "0",
    mentionable: true,
  };
}

function member(guildId: string, userId: string) {
  return { guildId, userId, nickname: null, joinedAt: "2024-01-01T00:00:00.000Z", roles: [] };
}

function channel(id: string, guildId: string, position: number, parentId: string | null = null) {
  return {
    id,
    guildId,
    type: "text" as const,
    name: `chan-${id}`,
    topic: null,
    position,
    parentId,
    permissionOverwrites: [],
  };
}

function guildView(id: string, channels: ReturnType<typeof channel>[] = []) {
  return {
    id,
    name: `Guild ${id}`,
    iconKey: null,
    ownerId: "owner-1",
    createdAt: "2024-01-01T00:00:00.000Z",
    roles: [role(id, id)],
    channels,
    member: member(id, "self-1"),
  };
}

function readyState(
  guilds: ReturnType<typeof guildView>[] = [],
  presences: Array<{ userId: string; status: string }> = [],
) {
  return applyDispatch(createInitialRealtimeState(), {
    t: "READY",
    d: { user: { id: "self-1" }, guilds, presences },
  });
}

describe("applyDispatch", () => {
  it("builds full state from READY", () => {
    const state = readyState(
      [guildView("g1", [channel("c1", "g1", 1), channel("c2", "g1", 0)])],
      [{ userId: "u2", status: "online" }],
    );
    expect(state.selfUserId).toBe("self-1");
    expect(Object.keys(state.guilds)).toEqual(["g1"]);
    expect(state.channelIdsByGuild.g1).toEqual(["c2", "c1"]);
    expect(state.rolesByGuild.g1).toHaveLength(1);
    expect(state.selfMemberByGuild.g1!.userId).toBe("self-1");
    expect(state.presences.u2).toBe("online");
  });

  it("RESUMED is a no-op", () => {
    const before = readyState([guildView("g1")]);
    const after = applyDispatch(before, { t: "RESUMED", d: {} });
    expect(after).toBe(before);
  });

  it("adds a guild on GUILD_CREATE, with its channels sorted", () => {
    const state = applyDispatch(createInitialRealtimeState(), {
      t: "GUILD_CREATE",
      d: guildView("g1", [channel("c2", "g1", 1), channel("c1", "g1", 0)]),
    });
    expect(state.guilds.g1!.name).toBe("Guild g1");
    expect(state.channelIdsByGuild.g1).toEqual(["c1", "c2"]);
  });

  it("updates a guild's fields on GUILD_UPDATE, and ignores an unknown guild", () => {
    const state = readyState([guildView("g1")]);
    const updated = applyDispatch(state, {
      t: "GUILD_UPDATE",
      d: {
        id: "g1",
        name: "Renamed",
        iconKey: null,
        ownerId: "owner-1",
        createdAt: "2024-01-01T00:00:00.000Z",
      },
    });
    expect(updated.guilds.g1!.name).toBe("Renamed");

    const untouched = applyDispatch(state, {
      t: "GUILD_UPDATE",
      d: {
        id: "ghost",
        name: "X",
        iconKey: null,
        ownerId: "owner-1",
        createdAt: "2024-01-01T00:00:00.000Z",
      },
    });
    expect(untouched).toBe(state);
  });

  it("removes a guild and its channels on GUILD_DELETE", () => {
    const state = readyState([guildView("g1", [channel("c1", "g1", 0)])]);
    const deleted = applyDispatch(state, { t: "GUILD_DELETE", d: { id: "g1" } });
    expect(deleted.guilds.g1).toBeUndefined();
    expect(deleted.channels.c1).toBeUndefined();
    expect(deleted.channelIdsByGuild.g1).toBeUndefined();
  });

  it("ignores GUILD_DELETE for an unknown guild", () => {
    const state = readyState([guildView("g1")]);
    const untouched = applyDispatch(state, { t: "GUILD_DELETE", d: { id: "ghost" } });
    expect(untouched).toBe(state);
  });

  it("adds and re-sorts channels on CHANNEL_CREATE, ignoring an unknown guild", () => {
    const state = readyState([guildView("g1", [channel("c1", "g1", 0)])]);
    const withNew = applyDispatch(state, { t: "CHANNEL_CREATE", d: channel("c0", "g1", -1) });
    expect(withNew.channelIdsByGuild.g1).toEqual(["c0", "c1"]);

    const untouched = applyDispatch(state, {
      t: "CHANNEL_CREATE",
      d: channel("cX", "ghost-guild", 0),
    });
    expect(untouched).toBe(state);
    expect(untouched.channels.cX).toBeUndefined();
  });

  it("updates a channel in place on CHANNEL_UPDATE, including a position change", () => {
    const state = readyState([guildView("g1", [channel("c1", "g1", 0), channel("c2", "g1", 1)])]);
    const renamed = applyDispatch(state, {
      t: "CHANNEL_UPDATE",
      d: { ...channel("c1", "g1", 5), name: "renamed" },
    });
    expect(renamed.channels.c1!.name).toBe("renamed");
    expect(renamed.channelIdsByGuild.g1).toEqual(["c2", "c1"]);
  });

  it("removes a channel on CHANNEL_DELETE, including a channel that was selected", () => {
    const state = readyState([guildView("g1", [channel("c1", "g1", 0), channel("c2", "g1", 1)])]);
    const afterDelete = applyDispatch(state, {
      t: "CHANNEL_DELETE",
      d: { id: "c1", guildId: "g1" },
    });
    expect(afterDelete.channels.c1).toBeUndefined();
    expect(afterDelete.channelIdsByGuild.g1).toEqual(["c2"]);
  });

  it("adds, updates and removes members", () => {
    let state = readyState([guildView("g1")]);
    state = applyDispatch(state, { t: "GUILD_MEMBER_ADD", d: member("g1", "u2") });
    expect(state.membersByGuild.g1!.u2!.userId).toBe("u2");

    state = applyDispatch(state, {
      t: "GUILD_MEMBER_UPDATE",
      d: { ...member("g1", "u2"), nickname: "Nick" },
    });
    expect(state.membersByGuild.g1!.u2!.nickname).toBe("Nick");

    state = applyDispatch(state, { t: "GUILD_MEMBER_REMOVE", d: { guildId: "g1", userId: "u2" } });
    expect(state.membersByGuild.g1!.u2).toBeUndefined();
  });

  it("keeps a member's known user profile across a GUILD_MEMBER_UPDATE that omits it", () => {
    // The server does not resend `user` on a role or nickname change
    // (see roles.ts's dispatchMemberUpdate): the reducer must not let
    // that revert a member's display name to their raw id.
    let state = readyState([guildView("g1")]);
    const withProfile = {
      ...member("g1", "u2"),
      user: { id: "u2", username: "u2name", displayName: "U2 Display", avatarKey: null },
    };
    state = applyDispatch(state, { t: "GUILD_MEMBER_ADD", d: withProfile });
    expect(state.membersByGuild.g1!.u2!.user?.displayName).toBe("U2 Display");

    // A role-change dispatch, with no `user` field at all.
    state = applyDispatch(state, {
      t: "GUILD_MEMBER_UPDATE",
      d: { guildId: "g1", userId: "u2", nickname: null, joinedAt: "2024-01-01T00:00:00.000Z", roles: ["r1"] },
    });
    expect(state.membersByGuild.g1!.u2!.user?.displayName).toBe("U2 Display");
    expect(state.membersByGuild.g1!.u2!.roles).toEqual(["r1"]);
  });

  it("updates the signed-in user's own member row on GUILD_MEMBER_UPDATE", () => {
    // Granting the caller a role must take effect immediately (their own
    // derived permissions read from selfMemberByGuild), with no reload.
    let state = readyState([guildView("g1")]);
    expect(state.selfMemberByGuild.g1!.roles).toEqual([]);

    state = applyDispatch(state, {
      t: "GUILD_MEMBER_UPDATE",
      d: { guildId: "g1", userId: "self-1", nickname: null, joinedAt: "2024-01-01T00:00:00.000Z", roles: ["r1"] },
    });
    expect(state.selfMemberByGuild.g1!.roles).toEqual(["r1"]);
  });

  it("ignores a member event for an unknown guild", () => {
    const state = readyState([guildView("g1")]);
    const untouched = applyDispatch(state, { t: "GUILD_MEMBER_ADD", d: member("ghost", "u2") });
    expect(untouched).toBe(state);
  });

  it("sets presence by user id, independent of guild", () => {
    const state = readyState([guildView("g1")]);
    const updated = applyDispatch(state, {
      t: "PRESENCE_UPDATE",
      d: { userId: "u9", status: "idle" },
    });
    expect(updated.presences.u9).toBe("idle");
  });

  it("never mutates the input state", () => {
    const state: RealtimeState = readyState([guildView("g1", [channel("c1", "g1", 0)])]);
    const snapshotChannels = { ...state.channels };
    applyDispatch(state, { t: "CHANNEL_CREATE", d: channel("c2", "g1", 1) });
    expect(state.channels).toEqual(snapshotChannels);
  });

  it("creates, updates and deletes a role", () => {
    let state = readyState([guildView("g1")]);
    const mods = {
      id: "r1",
      guildId: "g1",
      name: "Mods",
      color: 0,
      position: 1,
      permissions: "0",
      mentionable: true,
      hoist: false,
    };
    state = applyDispatch(state, { t: "GUILD_ROLE_CREATE", d: { guildId: "g1", role: mods } });
    expect(state.rolesByGuild.g1!.map((r) => r.id)).toEqual(["g1", "r1"]);

    state = applyDispatch(state, {
      t: "GUILD_ROLE_UPDATE",
      d: { guildId: "g1", role: { ...mods, name: "Renamed" } },
    });
    expect(state.rolesByGuild.g1!.find((r) => r.id === "r1")!.name).toBe("Renamed");

    state = applyDispatch(state, { t: "GUILD_ROLE_DELETE", d: { guildId: "g1", roleId: "r1" } });
    expect(state.rolesByGuild.g1!.map((r) => r.id)).toEqual(["g1"]);
  });

  it("ignores a role create for an unknown guild", () => {
    const state = readyState([guildView("g1")]);
    const untouched = applyDispatch(state, {
      t: "GUILD_ROLE_CREATE",
      d: {
        guildId: "ghost",
        role: {
          id: "r1",
          guildId: "ghost",
          name: "x",
          color: 0,
          position: 1,
          permissions: "0",
          mentionable: true,
          hoist: false,
        },
      },
    });
    expect(untouched).toBe(state);
  });

  it("adds and removes a ban", () => {
    let state = readyState([guildView("g1")]);
    const ban = { guildId: "g1", userId: "u2", reason: "spam", by: "owner-1" };
    state = applyDispatch(state, { t: "GUILD_BAN_ADD", d: ban });
    expect(state.bansByGuild.g1!.u2).toEqual(ban);

    state = applyDispatch(state, { t: "GUILD_BAN_REMOVE", d: { guildId: "g1", userId: "u2" } });
    expect(state.bansByGuild.g1!.u2).toBeUndefined();
  });

  it("ignores a ban removal that is not tracked", () => {
    const state = readyState([guildView("g1")]);
    const untouched = applyDispatch(state, {
      t: "GUILD_BAN_REMOVE",
      d: { guildId: "g1", userId: "u2" },
    });
    expect(untouched).toBe(state);
  });
});
