// Tests for computing the caller's own permissions from realtime-store
// data: guild-level, channel overwrites, and the "no context" fallback.
import { describe, expect, it } from "vitest";
import { Permission } from "@discord-clone/shared";
import { applyDispatch, createInitialRealtimeState } from "./realtime-store.js";
import { selfChannelPermissions, selfGuildPermissions } from "./permissions.js";

function baseState() {
  return applyDispatch(createInitialRealtimeState(), {
    t: "READY",
    d: {
      user: { id: "1003" },
      guilds: [
        {
          id: "1001",
          name: "Guild",
          iconKey: null,
          ownerId: "owner-1",
          createdAt: "2024-01-01T00:00:00.000Z",
          roles: [
            {
              id: "1001",
              guildId: "1001",
              name: "@everyone",
              color: 0,
              position: 0,
              permissions: (Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES).toString(),
              mentionable: true,
            },
          ],
          channels: [
            {
              id: "2001",
              guildId: "1001",
              type: "text",
              name: "general",
              topic: null,
              position: 0,
              parentId: null,
              permissionOverwrites: [
                { targetId: "1003", targetType: "member", allow: "0", deny: Permission.SEND_MESSAGES.toString() },
              ],
            },
          ],
          member: { guildId: "1001", userId: "1003", nickname: null, joinedAt: "2024-01-01T00:00:00.000Z", roles: [] },
        },
      ],
      presences: [],
    },
  });
}

describe("selfGuildPermissions / selfChannelPermissions", () => {
  it("computes guild-level permissions from @everyone", () => {
    const state = baseState();
    const permissions = selfGuildPermissions(state, "1001");
    expect((permissions & Permission.VIEW_CHANNEL) !== 0n).toBe(true);
    expect((permissions & Permission.SEND_MESSAGES) !== 0n).toBe(true);
  });

  it("applies a member overwrite to channel-level permissions", () => {
    const state = baseState();
    const permissions = selfChannelPermissions(state, "2001");
    expect((permissions & Permission.VIEW_CHANNEL) !== 0n).toBe(true);
    // Denied by the member overwrite.
    expect((permissions & Permission.SEND_MESSAGES) !== 0n).toBe(false);
  });

  it("returns 0 for an unknown guild or channel", () => {
    const state = baseState();
    expect(selfGuildPermissions(state, "ghost")).toBe(0n);
    expect(selfChannelPermissions(state, "ghost")).toBe(0n);
  });
});
