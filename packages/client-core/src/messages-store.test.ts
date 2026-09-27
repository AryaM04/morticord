import { describe, expect, it } from "vitest";
import type { DecryptedPayload, EventJson } from "@discord-clone/shared";
import {
  addPending,
  advanceReadMarker,
  aggregateEvent,
  applyEventCreate,
  applyEventRedact,
  clearTypingForSender,
  compareIds,
  countMentions,
  createChannelMessagesState,
  expireTyping,
  isChannelUnread,
  loadPage,
  markAllStale,
  markPendingFailed,
  markTypingSent,
  MAX_WINDOW_EVENTS,
  needsStaleRefetch,
  reconcilePosted,
  removePending,
  seedChannelBaseline,
  setPayload,
  setTypingStart,
  shouldSendTyping,
  touchChannel,
  trimWindow,
  createInitialMessagesState,
  type ChannelMessagesState,
  type PendingMessage,
} from "./messages-store.js";

function event(overrides: Partial<EventJson> = {}): EventJson {
  return {
    id: "1",
    channelId: "10",
    senderId: "20",
    senderDeviceId: "device-1",
    relType: null,
    relatesToId: null,
    codec: "plain-v1",
    megolmSessionId: null,
    ciphertext: "cipher",
    nonce: "n1",
    createdAt: "2026-01-01T00:00:00.000Z",
    redactedAt: null,
    ...overrides,
  };
}

function withEvent(channel: ChannelMessagesState, e: EventJson): ChannelMessagesState {
  return { ...channel, eventIds: [...channel.eventIds, e.id], eventsById: { ...channel.eventsById, [e.id]: e } };
}

/** Type helper so payload literals in tests infer as `DecryptedPayload`, not widened strings. */
function payloadsOf(record: Record<string, DecryptedPayload>): Record<string, DecryptedPayload> {
  return record;
}

describe("compareIds", () => {
  it("compares snowflakes numerically, not as text", () => {
    expect(compareIds("9", "10")).toBeLessThan(0);
    expect(compareIds("10", "9")).toBeGreaterThan(0);
    expect(compareIds("10", "10")).toBe(0);
  });
});

describe("aggregateEvent", () => {
  it("uses the original payload when there is no edit", () => {
    const original = event({ id: "1" });
    const result = aggregateEvent(
      original,
      [],
      payloadsOf({ "1": { type: "message", body: "hi", mentions: [], attachments: [], embeds: [] } }),
    );
    expect(result.body).toBe("hi");
    expect(result.edited).toBe(false);
  });

  it("applies the latest edit from the original sender", () => {
    const original = event({ id: "1", senderId: "20" });
    const edit1 = event({ id: "2", senderId: "20", relType: "edit", relatesToId: "1" });
    const edit2 = event({ id: "3", senderId: "20", relType: "edit", relatesToId: "1" });
    const payloads = payloadsOf({
      "1": { type: "message", body: "original", mentions: [], attachments: [], embeds: [] },
      "2": { type: "edit", body: "first edit", mentions: [] },
      "3": { type: "edit", body: "second edit", mentions: [] },
    });
    const result = aggregateEvent(original, [edit1, edit2], payloads);
    expect(result.body).toBe("second edit");
    expect(result.edited).toBe(true);
  });

  it("ignores an edit from anyone but the original sender", () => {
    const original = event({ id: "1", senderId: "20" });
    const impostorEdit = event({ id: "2", senderId: "99", relType: "edit", relatesToId: "1" });
    const payloads = payloadsOf({
      "1": { type: "message", body: "original", mentions: [], attachments: [], embeds: [] },
      "2": { type: "edit", body: "hijacked", mentions: [] },
    });
    const result = aggregateEvent(original, [impostorEdit], payloads);
    expect(result.body).toBe("original");
    expect(result.edited).toBe(false);
  });

  it("aggregates reactions by key into a set of user ids", () => {
    const original = event({ id: "1" });
    const r1 = event({ id: "2", senderId: "a", relType: "reaction", relatesToId: "1" });
    const r2 = event({ id: "3", senderId: "b", relType: "reaction", relatesToId: "1" });
    const payloads = payloadsOf({
      "1": { type: "message", body: "hi", mentions: [], attachments: [], embeds: [] },
      "2": { type: "reaction", key: "👍" },
      "3": { type: "reaction", key: "👍" },
    });
    const result = aggregateEvent(original, [r1, r2], payloads);
    expect(result.reactions).toEqual([{ key: "👍", userIds: ["a", "b"], ownEventId: null }]);
  });

  it("marks the self user's own reaction event id, for removal", () => {
    const original = event({ id: "1" });
    const own = event({ id: "2", senderId: "self", relType: "reaction", relatesToId: "1" });
    const payloads = payloadsOf({
      "1": { type: "message", body: "hi", mentions: [], attachments: [], embeds: [] },
      "2": { type: "reaction", key: "👍" },
    });
    const result = aggregateEvent(original, [own], payloads, "self");
    expect(result.reactions[0]!.ownEventId).toBe("2");
  });

  it("drops a redacted reaction from the aggregate", () => {
    const original = event({ id: "1" });
    const removed = event({ id: "2", senderId: "a", relType: "reaction", relatesToId: "1", redactedAt: "2026-01-01T00:00:01.000Z" });
    const payloads = payloadsOf({ "1": { type: "message", body: "hi", mentions: [], attachments: [], embeds: [] } });
    const result = aggregateEvent(original, [removed], payloads);
    expect(result.reactions).toEqual([]);
  });

  it("shows a tombstone for a redacted event, without a body payload", () => {
    const redacted = event({ id: "1", redactedAt: "2026-01-01T00:00:01.000Z", ciphertext: "" });
    const result = aggregateEvent(redacted, [], {});
    expect(result.deleted).toBe(true);
    expect(result.body).toBe("This message was deleted.");
  });

  it("marks a message that failed to decode as cannotRead, with the fallback text", () => {
    const original = event({ id: "1" });
    const result = aggregateEvent(original, [], { "1": null });
    expect(result.cannotRead).toBe(true);
    expect(result.body).toBe("This message cannot be read.");
  });
});

describe("trimWindow", () => {
  it("does nothing under the cap", () => {
    const channel: ChannelMessagesState = { ...createChannelMessagesState(), eventIds: ["1", "2", "3"] };
    expect(trimWindow(channel, "after")).toBe(channel);
  });

  it("drops from the front and sets hasMoreBefore when the after side grew past the cap", () => {
    const ids = Array.from({ length: MAX_WINDOW_EVENTS + 5 }, (_, i) => String(i + 1));
    const eventsById: Record<string, EventJson> = {};
    for (const id of ids) eventsById[id] = event({ id });
    const channel: ChannelMessagesState = { ...createChannelMessagesState(), eventIds: ids, eventsById };
    const trimmed = trimWindow(channel, "after");
    expect(trimmed.eventIds.length).toBe(MAX_WINDOW_EVENTS);
    expect(trimmed.eventIds[0]).toBe("6");
    expect(trimmed.hasMoreBefore).toBe(true);
  });

  it("drops from the back and sets hasMoreAfter when the before side grew past the cap", () => {
    const ids = Array.from({ length: MAX_WINDOW_EVENTS + 5 }, (_, i) => String(i + 1));
    const eventsById: Record<string, EventJson> = {};
    for (const id of ids) eventsById[id] = event({ id });
    const channel: ChannelMessagesState = { ...createChannelMessagesState(), eventIds: ids, eventsById };
    const trimmed = trimWindow(channel, "before");
    expect(trimmed.eventIds.length).toBe(MAX_WINDOW_EVENTS);
    expect(trimmed.eventIds[trimmed.eventIds.length - 1]).toBe(String(MAX_WINDOW_EVENTS));
    expect(trimmed.hasMoreAfter).toBe(true);
  });
});

describe("loadPage", () => {
  it("sets up the initial page with the server's hasMore flags", () => {
    const channel = createChannelMessagesState();
    const page = { events: [event({ id: "1" }), event({ id: "2" })], relations: [], hasMoreBefore: true, hasMoreAfter: false };
    const next = loadPage(channel, page, "initial");
    expect(next.eventIds).toEqual(["1", "2"]);
    expect(next.hasMoreBefore).toBe(true);
    expect(next.hasMoreAfter).toBe(false);
  });

  it("prepends an older page and keeps newer events", () => {
    let channel = createChannelMessagesState();
    channel = loadPage(channel, { events: [event({ id: "5" })], relations: [], hasMoreBefore: true, hasMoreAfter: false }, "initial");
    channel = loadPage(channel, { events: [event({ id: "3" }), event({ id: "4" })], relations: [], hasMoreBefore: false, hasMoreAfter: false }, "before");
    expect(channel.eventIds).toEqual(["3", "4", "5"]);
    expect(channel.hasMoreBefore).toBe(false);
  });

  it("appends a newer page and keeps older events", () => {
    let channel = createChannelMessagesState();
    channel = loadPage(channel, { events: [event({ id: "1" })], relations: [], hasMoreBefore: false, hasMoreAfter: true }, "initial");
    channel = loadPage(channel, { events: [event({ id: "2" }), event({ id: "3" })], relations: [], hasMoreBefore: false, hasMoreAfter: false }, "after");
    expect(channel.eventIds).toEqual(["1", "2", "3"]);
    expect(channel.hasMoreAfter).toBe(false);
  });
});

describe("applyEventCreate and pending reconciliation", () => {
  const pending: PendingMessage = {
    nonce: "abc",
    channelId: "10",
    body: "hello",
    mentions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    state: "sending",
  };

  it("appends a live event when the window is at the latest page", () => {
    const channel = createChannelMessagesState();
    const next = applyEventCreate(channel, event({ id: "1" }));
    expect(next.eventIds).toEqual(["1"]);
  });

  it("does not append when the window is not at the latest page, but tracks lastEventId", () => {
    const channel: ChannelMessagesState = { ...createChannelMessagesState(), atLatest: false };
    const next = applyEventCreate(channel, event({ id: "1" }));
    expect(next.eventIds).toEqual([]);
    expect(next.lastEventId).toBe("1");
  });

  it("reconciles pending-then-EVENT_CREATE: the create removes the pending entry and is added", () => {
    let channel = addPending(createChannelMessagesState(), pending);
    channel = applyEventCreate(channel, event({ id: "1", nonce: "abc" }));
    expect(channel.pending).toEqual([]);
    expect(channel.eventIds).toEqual(["1"]);
  });

  it("reconciles EVENT_CREATE-then-POST-response: the POST response is a no-op beyond dropping pending", () => {
    let channel = addPending(createChannelMessagesState(), pending);
    channel = applyEventCreate(channel, event({ id: "1", nonce: "abc" }));
    // The POST response arrives after the dispatch already added the event.
    const posted = event({ id: "1", nonce: "abc" });
    channel = reconcilePosted(channel, posted);
    expect(channel.eventIds).toEqual(["1"]);
    expect(channel.pending).toEqual([]);
  });

  it("reconciles POST-response-before-EVENT_CREATE: the POST response adds the event, and the later dispatch is ignored", () => {
    let channel = addPending(createChannelMessagesState(), pending);
    const posted = event({ id: "1", nonce: "abc" });
    channel = reconcilePosted(channel, posted);
    expect(channel.eventIds).toEqual(["1"]);
    expect(channel.pending).toEqual([]);
    // The EVENT_CREATE dispatch for the same id now arrives; it must not duplicate.
    channel = applyEventCreate(channel, posted);
    expect(channel.eventIds).toEqual(["1"]);
  });

  it("routes an edit/reaction relation to its target instead of the timeline", () => {
    const channel = createChannelMessagesState();
    const reaction = event({ id: "2", relType: "reaction", relatesToId: "1" });
    const next = applyEventCreate(channel, reaction);
    expect(next.eventIds).toEqual([]);
    expect(next.relationsByTarget["1"]).toEqual([reaction]);
  });

  it("marks a pending send as failed", () => {
    let channel = addPending(createChannelMessagesState(), pending);
    channel = markPendingFailed(channel, "abc");
    expect(channel.pending[0]!.state).toBe("failed");
  });

  it("discards a pending send", () => {
    let channel = addPending(createChannelMessagesState(), pending);
    channel = removePending(channel, "abc");
    expect(channel.pending).toEqual([]);
  });
});

describe("applyEventRedact", () => {
  it("removes a timeline event with no reply pointing at it", () => {
    let channel = createChannelMessagesState();
    channel = withEvent(channel, event({ id: "1" }));
    channel = applyEventRedact(channel, ["1"]);
    expect(channel.eventIds).toEqual([]);
  });

  it("tombstones a timeline event that a loaded reply targets", () => {
    let channel = createChannelMessagesState();
    channel = withEvent(channel, event({ id: "1" }));
    channel = withEvent(channel, event({ id: "2", relType: "reply", relatesToId: "1" }));
    channel = applyEventRedact(channel, ["1"]);
    expect(channel.eventIds).toContain("1");
    expect(channel.eventsById["1"]!.redactedAt).not.toBeNull();
  });

  it("removes a redacted relation from its target's aggregate", () => {
    let channel = createChannelMessagesState();
    const reaction = event({ id: "2", relType: "reaction", relatesToId: "1" });
    channel = { ...channel, relationsByTarget: { "1": [reaction] } };
    channel = applyEventRedact(channel, ["2"]);
    expect(channel.relationsByTarget["1"]).toBeUndefined();
  });
});

describe("stale refetch", () => {
  it("marks every open window stale after a fresh READY", () => {
    const channels = { "1": createChannelMessagesState(), "2": createChannelMessagesState() };
    const next = markAllStale(channels);
    expect(next["1"]!.stale).toBe(true);
    expect(next["2"]!.stale).toBe(true);
  });

  it("needsStaleRefetch is true only for a stale channel", () => {
    expect(needsStaleRefetch({ ...createChannelMessagesState(), stale: true })).toBe(true);
    expect(needsStaleRefetch(createChannelMessagesState())).toBe(false);
    expect(needsStaleRefetch(undefined)).toBe(false);
  });
});

describe("seedChannelBaseline", () => {
  it("creates a channel entry for a channel with no window, from READY data", () => {
    const channels = seedChannelBaseline({}, "10", "5", "3");
    expect(channels["10"]!.lastEventId).toBe("5");
    expect(channels["10"]!.lastReadEventId).toBe("3");
  });

  it("never moves an already-tracked lastEventId or read marker backward", () => {
    let channels = seedChannelBaseline({}, "10", "5", "3");
    channels = seedChannelBaseline(channels, "10", "2", "1");
    expect(channels["10"]!.lastEventId).toBe("5");
    expect(channels["10"]!.lastReadEventId).toBe("3");
  });

  it("does not disturb an already-loaded window's events", () => {
    let channel = createChannelMessagesState();
    channel = withEvent(channel, event({ id: "1" }));
    const channels = seedChannelBaseline({ "10": channel }, "10", "1", null);
    expect(channels["10"]!.eventIds).toEqual(["1"]);
  });
});

describe("unread and mentions", () => {
  it("a channel is unread when lastEventId is newer than the read marker", () => {
    expect(isChannelUnread("5", "3")).toBe(true);
    expect(isChannelUnread("3", "5")).toBe(false);
    expect(isChannelUnread("5", null)).toBe(true);
    expect(isChannelUnread(null, null)).toBe(false);
  });

  it("counts decoded messages after the read marker that mention self", () => {
    let channel = createChannelMessagesState();
    channel = { ...channel, lastReadEventId: "1" };
    channel = withEvent(channel, event({ id: "2" }));
    channel = withEvent(channel, event({ id: "3" }));
    channel = setPayload(channel, "2", { type: "message", body: "hey @self", mentions: ["self"], attachments: [], embeds: [] });
    channel = setPayload(channel, "3", { type: "message", body: "no mention", mentions: [], attachments: [], embeds: [] });
    expect(countMentions(channel, "self")).toBe(1);
  });

  it("does not count a message at or before the read marker", () => {
    let channel = createChannelMessagesState();
    channel = { ...channel, lastReadEventId: "2" };
    channel = withEvent(channel, event({ id: "2" }));
    channel = setPayload(channel, "2", { type: "message", body: "hey @self", mentions: ["self"], attachments: [], embeds: [] });
    expect(countMentions(channel, "self")).toBe(0);
  });
});

describe("read marker", () => {
  it("advances forward", () => {
    const channel = advanceReadMarker(createChannelMessagesState(), "5");
    expect(channel.lastReadEventId).toBe("5");
  });

  it("never moves backward", () => {
    let channel = advanceReadMarker(createChannelMessagesState(), "5");
    channel = advanceReadMarker(channel, "3");
    expect(channel.lastReadEventId).toBe("5");
  });
});

describe("typing", () => {
  it("shows a user for the timeout window and expires them after it passes", () => {
    let channel = setTypingStart(createChannelMessagesState(), "u1", 1_000);
    expect(channel.typing["u1"]).toBe(1_000 + 8_000);
    channel = expireTyping(channel, 1_000 + 8_000 - 1);
    expect(channel.typing["u1"]).toBeDefined();
    channel = expireTyping(channel, 1_000 + 8_000 + 1);
    expect(channel.typing["u1"]).toBeUndefined();
  });

  it("clears a typing user once a message from them arrives", () => {
    let channel = setTypingStart(createChannelMessagesState(), "u1", 1_000);
    channel = clearTypingForSender(channel, "u1");
    expect(channel.typing["u1"]).toBeUndefined();
  });

  it("throttles notifyTyping sends to once per interval", () => {
    let channel = createChannelMessagesState();
    expect(shouldSendTyping(channel, 0)).toBe(true);
    channel = markTypingSent(channel, 0);
    expect(shouldSendTyping(channel, 2_999)).toBe(false);
    expect(shouldSendTyping(channel, 3_000)).toBe(true);
  });
});

describe("channel LRU cache", () => {
  it("evicts the least recently used channel past the cap", () => {
    let state = createInitialMessagesState();
    for (let i = 1; i <= 21; i++) {
      state = touchChannel(state, String(i));
      state = { ...state, channels: { ...state.channels, [String(i)]: createChannelMessagesState() } };
    }
    expect(state.channelOrder.length).toBe(20);
    expect(state.channels["1"]).toBeUndefined();
    expect(state.channels["21"]).toBeDefined();
  });

  it("re-touching a cached channel moves it to the end without evicting it", () => {
    let state = createInitialMessagesState();
    state = touchChannel(state, "a");
    state = touchChannel(state, "b");
    state = touchChannel(state, "a");
    expect(state.channelOrder).toEqual(["b", "a"]);
  });
});
