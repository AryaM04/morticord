// Tests for the friend, DM and settings schemas, and the DM permission mask.
import { describe, expect, it } from "vitest";
import { encodeBase64Url } from "../base64.js";
import { DM_PERMISSIONS, Permission } from "../permissions.js";
import { readyPayloadSchema } from "../gateway.js";
import { createDmRequestSchema, groupDmNameSchema, updateGroupDmRequestSchema } from "./dms.js";
import { relationshipActionRequestSchema, sendFriendRequestSchema } from "./friends.js";
import { MAX_SETTINGS_BYTES, putSettingsRequestSchema, settingsResponseSchema } from "./settings.js";
import { voiceStateSchema } from "./voice.js";

describe("createDmRequestSchema", () => {
  it("accepts 1 to 9 different recipients", () => {
    expect(createDmRequestSchema.safeParse({ recipientIds: ["1"] }).success).toBe(true);
    const nine = Array.from({ length: 9 }, (_, i) => String(i + 1));
    expect(createDmRequestSchema.safeParse({ recipientIds: nine }).success).toBe(true);
  });

  it("rejects no recipient, 10 recipients, a repeat and a bad id", () => {
    expect(createDmRequestSchema.safeParse({ recipientIds: [] }).success).toBe(false);
    const ten = Array.from({ length: 10 }, (_, i) => String(i + 1));
    expect(createDmRequestSchema.safeParse({ recipientIds: ten }).success).toBe(false);
    expect(createDmRequestSchema.safeParse({ recipientIds: ["1", "1"] }).success).toBe(false);
    expect(createDmRequestSchema.safeParse({ recipientIds: ["abc"] }).success).toBe(false);
  });
});

describe("group DM name", () => {
  it("trims the name, and allows null to clear it", () => {
    expect(groupDmNameSchema.parse("  Crew  ")).toBe("Crew");
    expect(updateGroupDmRequestSchema.parse({ name: null })).toEqual({ name: null });
    expect(updateGroupDmRequestSchema.parse({})).toEqual({});
  });

  it("rejects an empty name and a name over 100 characters", () => {
    expect(groupDmNameSchema.safeParse("   ").success).toBe(false);
    expect(groupDmNameSchema.safeParse("x".repeat(101)).success).toBe(false);
  });
});

describe("friend request schemas", () => {
  it("lowercases the username", () => {
    expect(sendFriendRequestSchema.parse({ username: " Alice " })).toEqual({ username: "alice" });
  });

  it("accepts only accept and block as an action", () => {
    expect(relationshipActionRequestSchema.safeParse({ action: "accept" }).success).toBe(true);
    expect(relationshipActionRequestSchema.safeParse({ action: "block" }).success).toBe(true);
    expect(relationshipActionRequestSchema.safeParse({ action: "unblock" }).success).toBe(false);
  });
});

describe("settings schemas", () => {
  it("accepts data up to the limit and no more", () => {
    const limit = encodeBase64Url(new Uint8Array(MAX_SETTINGS_BYTES));
    const over = encodeBase64Url(new Uint8Array(MAX_SETTINGS_BYTES + 1));
    expect(putSettingsRequestSchema.safeParse({ data: limit, version: 0 }).success).toBe(true);
    expect(putSettingsRequestSchema.safeParse({ data: over, version: 0 }).success).toBe(false);
  });

  it("needs a version that is a whole number of at least 0", () => {
    expect(putSettingsRequestSchema.safeParse({ data: "", version: -1 }).success).toBe(false);
    expect(putSettingsRequestSchema.safeParse({ data: "", version: 1.5 }).success).toBe(false);
    expect(putSettingsRequestSchema.safeParse({ data: "" }).success).toBe(false);
  });

  it("allows a null data field in a response", () => {
    expect(settingsResponseSchema.safeParse({ data: null, version: 0 }).success).toBe(true);
  });
});

describe("voice state and READY", () => {
  const state = {
    channelId: "5",
    userId: "1",
    deviceId: "d",
    selfMute: false,
    selfDeaf: false,
    selfVideo: false,
    selfStream: false,
    serverMute: false,
    serverDeaf: false,
    joinedAt: "2024-01-01T00:00:00.000Z",
  };

  it("allows a null guild id for a DM call", () => {
    expect(voiceStateSchema.safeParse({ ...state, guildId: null }).success).toBe(true);
    expect(voiceStateSchema.safeParse({ ...state, guildId: "9" }).success).toBe(true);
  });

  it("fills in the DM fields of READY when an older server leaves them out", () => {
    const parsed = readyPayloadSchema.parse({
      sessionId: "s",
      user: { id: "1" },
      guilds: [],
      presences: [],
      readStates: [],
    });
    expect(parsed.relationships).toEqual([]);
    expect(parsed.privateChannels).toEqual([]);
    expect(parsed.privateVoiceStates).toEqual([]);
  });
});

describe("DM_PERMISSIONS", () => {
  it("has the chat and call permissions and no MANAGE permission", () => {
    for (const name of [
      "VIEW_CHANNEL",
      "SEND_MESSAGES",
      "READ_MESSAGE_HISTORY",
      "ADD_REACTIONS",
      "ATTACH_FILES",
      "CONNECT",
      "SPEAK",
      "VIDEO",
      "STREAM",
    ] as const) {
      expect(DM_PERMISSIONS & Permission[name]).toBe(Permission[name]);
    }
    for (const name of Object.keys(Permission) as Array<keyof typeof Permission>) {
      if (name.startsWith("MANAGE_")) {
        expect(DM_PERMISSIONS & Permission[name]).toBe(0n);
      }
    }
    expect(DM_PERMISSIONS & Permission.ADMINISTRATOR).toBe(0n);
  });
});
