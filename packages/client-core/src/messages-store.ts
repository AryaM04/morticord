// The message store: one contiguous, bounded window of timeline events per
// channel, decoded payloads, aggregated edits and reactions, optimistic
// sends, typing state and read state. The logic below is pure functions
// (easy to unit test); `createMessagesStore` wraps them in a vanilla
// zustand store and adds the I/O: the codec, the REST calls and the
// gateway send.
import { createStore, type StoreApi } from "zustand/vanilla";
import { encodeBase64Url, GatewayOpcode, type DecryptedPayload, type EventJson } from "@discord-clone/shared";
import type { ApiClient } from "./api.js";
import type { PayloadCodec } from "./codec.js";
import * as messagesApi from "./messages-api.js";

/** Keep at most this many timeline events loaded per channel window. */
export const MAX_WINDOW_EVENTS = 300;
/** Keep at most this many channels' windows cached at once (LRU). */
export const MAX_CACHED_CHANNELS = 20;
/** How long a typed indicator stays up with no message and no repeat TYPING_START. */
export const TYPING_TIMEOUT_MS = 8_000;
/** How often `notifyTyping` actually sends the TYPING op. */
export const TYPING_SEND_INTERVAL_MS = 3_000;
/** How long to wait after a local change before sending the read marker. */
export const READ_STATE_DEBOUNCE_MS = 1_000;

// ---- ids ------------------------------------------------------------------

/** Event ids are decimal snowflakes: compare as bigint, not as text. */
export function compareIds(a: string, b: string): number {
  const bigA = BigInt(a);
  const bigB = BigInt(b);
  return bigA < bigB ? -1 : bigA > bigB ? 1 : 0;
}

function idGreaterThan(a: string | null, b: string | null): boolean {
  if (a === null) return false;
  if (b === null) return true;
  return compareIds(a, b) > 0;
}

// ---- pending sends ----------------------------------------------------------

export type PendingSendState = "sending" | "failed";

export interface PendingMessage {
  nonce: string;
  channelId: string;
  body: string;
  mentions: string[];
  relType?: "reply";
  relatesToId?: string;
  createdAt: string;
  state: PendingSendState;
}

// ---- aggregated view of one timeline event --------------------------------

export interface AggregatedReaction {
  key: string;
  userIds: string[];
  /** This user's own reaction event id for this key, if any (used to remove it). */
  ownEventId: string | null;
}

export interface AggregatedMessage {
  id: string;
  senderId: string;
  senderDeviceId: string;
  createdAt: string;
  relType: "reply" | null;
  relatesToId: string | null;
  /** True once the server has redacted this event. */
  deleted: boolean;
  /** True when the payload exists but failed to decode (never true when `deleted`). */
  cannotRead: boolean;
  body: string;
  mentions: string[];
  edited: boolean;
  reactions: AggregatedReaction[];
}

/**
 * Combine one timeline event with its loaded relations (edits and
 * reactions) into the shape the UI renders. `payloads` holds the decode
 * result for the event itself and for each relation, keyed by event id;
 * a missing entry means "not decoded yet" and is treated like a pending
 * message (no body yet, not marked unreadable).
 */
export function aggregateEvent(
  event: EventJson,
  relations: EventJson[],
  payloads: Record<string, DecryptedPayload | null | undefined>,
  selfUserId: string | null = null,
): AggregatedMessage {
  const base: AggregatedMessage = {
    id: event.id,
    senderId: event.senderId,
    senderDeviceId: event.senderDeviceId,
    createdAt: event.createdAt,
    relType: event.relType === "reply" ? "reply" : null,
    relatesToId: event.relatesToId,
    deleted: event.redactedAt !== null,
    cannotRead: false,
    body: "",
    mentions: [],
    edited: false,
    reactions: [],
  };

  if (base.deleted) {
    base.body = "This message was deleted.";
    return base;
  }

  const ownPayload = payloads[event.id];
  if (ownPayload === null) {
    base.cannotRead = true;
    base.body = "This message cannot be read.";
  } else if (ownPayload && ownPayload.type !== "reaction") {
    base.body = ownPayload.body;
    base.mentions = ownPayload.mentions;
  }

  // The latest edit (highest event id) from the ORIGINAL sender wins.
  // An edit posted by anyone else is never applied, even if the payload
  // decoded fine: the server would have rejected it, but a client must
  // not trust a payload's own claims over who actually sent the event.
  const edits = relations
    .filter((r) => r.relType === "edit" && r.redactedAt === null && r.senderId === event.senderId)
    .slice()
    .sort((a, b) => compareIds(b.id, a.id));
  for (const edit of edits) {
    const payload = payloads[edit.id];
    if (payload && payload.type === "edit") {
      base.body = payload.body;
      base.mentions = payload.mentions;
      base.edited = true;
      base.cannotRead = false;
      break;
    }
    if (payload === null) {
      // This particular edit failed to decode; fall through to an older one.
      continue;
    }
    // Not decoded yet: wait rather than show a stale body.
    break;
  }

  const reactionsByKey = new Map<string, { userIds: string[]; ownEventId: string | null }>();
  const reactionRelations = relations
    .filter((r) => r.relType === "reaction" && r.redactedAt === null)
    .slice()
    .sort((a, b) => compareIds(a.id, b.id));
  for (const relation of reactionRelations) {
    const payload = payloads[relation.id];
    if (!payload || payload.type !== "reaction") {
      continue;
    }
    let entry = reactionsByKey.get(payload.key);
    if (!entry) {
      entry = { userIds: [], ownEventId: null };
      reactionsByKey.set(payload.key, entry);
    }
    if (!entry.userIds.includes(relation.senderId)) {
      entry.userIds.push(relation.senderId);
    }
    if (selfUserId && relation.senderId === selfUserId) {
      entry.ownEventId = relation.id;
    }
  }
  base.reactions = [...reactionsByKey.entries()].map(([key, value]) => ({
    key,
    userIds: value.userIds,
    ownEventId: value.ownEventId,
  }));

  return base;
}

// ---- channel window state ---------------------------------------------------

export interface ChannelMessagesState {
  /** Timeline event ids currently loaded, ascending. */
  eventIds: string[];
  eventsById: Record<string, EventJson>;
  /** Non-redacted edit/reaction events, keyed by their `relatesToId`. */
  relationsByTarget: Record<string, EventJson[]>;
  /** Decode results, keyed by event id (own timeline events and relations alike). */
  payloads: Record<string, DecryptedPayload | null | undefined>;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  /** True when the window's newest event is the channel's actual newest event. */
  atLatest: boolean;
  /** True right after a fresh READY, until the latest page is refetched. */
  stale: boolean;
  lastEventId: string | null;
  lastReadEventId: string | null;
  pending: PendingMessage[];
  typing: Record<string, number>;
  lastTypingSentAt: number;
}

export function createChannelMessagesState(): ChannelMessagesState {
  return {
    eventIds: [],
    eventsById: {},
    relationsByTarget: {},
    payloads: {},
    hasMoreBefore: false,
    hasMoreAfter: false,
    atLatest: true,
    stale: false,
    lastEventId: null,
    lastReadEventId: null,
    pending: [],
    typing: {},
    lastTypingSentAt: -Infinity,
  };
}

/** Drop events from the far side once the window exceeds `MAX_WINDOW_EVENTS`, and mark that side as having more. */
export function trimWindow(channel: ChannelMessagesState, keepSide: "before" | "after"): ChannelMessagesState {
  if (channel.eventIds.length <= MAX_WINDOW_EVENTS) {
    return channel;
  }
  const overflow = channel.eventIds.length - MAX_WINDOW_EVENTS;
  let eventIds: string[];
  let hasMoreBefore = channel.hasMoreBefore;
  let hasMoreAfter = channel.hasMoreAfter;
  if (keepSide === "after") {
    // We just grew the "after" (newest) side, so drop from the front.
    eventIds = channel.eventIds.slice(overflow);
    hasMoreBefore = true;
  } else {
    // We just grew the "before" (oldest) side, so drop from the back.
    eventIds = channel.eventIds.slice(0, MAX_WINDOW_EVENTS);
    hasMoreAfter = true;
  }
  const eventsById: Record<string, EventJson> = {};
  for (const id of eventIds) {
    eventsById[id] = channel.eventsById[id]!;
  }
  return { ...channel, eventIds, eventsById, hasMoreBefore, hasMoreAfter };
}

function withRelations(channel: ChannelMessagesState, relations: EventJson[]): ChannelMessagesState {
  if (relations.length === 0) {
    return channel;
  }
  const relationsByTarget = { ...channel.relationsByTarget };
  for (const relation of relations) {
    if (relation.relatesToId === null) continue;
    const list = relationsByTarget[relation.relatesToId] ?? [];
    if (list.some((r) => r.id === relation.id)) continue;
    relationsByTarget[relation.relatesToId] = [...list, relation];
  }
  return { ...channel, relationsByTarget };
}

/** Merge a freshly fetched page of timeline events (plus its relations) into the window. */
export function loadPage(
  channel: ChannelMessagesState,
  page: { events: EventJson[]; relations: EventJson[]; hasMoreBefore: boolean; hasMoreAfter: boolean },
  mode: "initial" | "before" | "after",
): ChannelMessagesState {
  const newIds = page.events.map((e) => e.id).filter((id) => !(id in channel.eventsById));
  const eventsById = { ...channel.eventsById };
  for (const event of page.events) {
    eventsById[event.id] = event;
  }

  let eventIds: string[];
  let hasMoreBefore = channel.hasMoreBefore;
  let hasMoreAfter = channel.hasMoreAfter;
  let keepSide: "before" | "after" = "after";
  if (mode === "initial") {
    eventIds = page.events.map((e) => e.id);
    hasMoreBefore = page.hasMoreBefore;
    hasMoreAfter = page.hasMoreAfter;
  } else if (mode === "before") {
    eventIds = [...newIds, ...channel.eventIds];
    hasMoreBefore = page.hasMoreBefore;
    keepSide = "before";
  } else {
    eventIds = [...channel.eventIds, ...newIds];
    hasMoreAfter = page.hasMoreAfter;
    keepSide = "after";
  }

  let next: ChannelMessagesState = {
    ...channel,
    eventIds,
    eventsById,
    hasMoreBefore,
    hasMoreAfter,
    stale: false,
  };
  next = withRelations(next, page.relations);
  next = trimWindow(next, keepSide);
  return next;
}

/** Replace the whole window with an `around` page (`jumpTo`). */
export function jumpToPage(
  channel: ChannelMessagesState,
  page: { events: EventJson[]; relations: EventJson[]; hasMoreBefore: boolean; hasMoreAfter: boolean },
): ChannelMessagesState {
  const fresh = createChannelMessagesState();
  return loadPage(
    { ...fresh, lastEventId: channel.lastEventId, lastReadEventId: channel.lastReadEventId, pending: channel.pending },
    page,
    "initial",
  );
}

/**
 * Apply a live EVENT_CREATE. Appends to the window only when the window is
 * `atLatest`; a relation (edit/reaction) updates the aggregate for its
 * target whether or not the target is in the visible window slice, as
 * long as the target is loaded at all. When this event reconciles a
 * pending optimistic send (matching nonce), the pending entry is dropped.
 */
export function applyEventCreate(channel: ChannelMessagesState, event: EventJson): ChannelMessagesState {
  let next = channel;

  // Reconcile: drop the pending entry with the same nonce, in whatever order it arrives.
  if (next.pending.some((p) => p.nonce === event.nonce)) {
    next = { ...next, pending: next.pending.filter((p) => p.nonce !== event.nonce) };
  }

  if (event.id in next.eventsById) {
    // Already known (e.g. this event's own POST response arrived after the dispatch). Ignore.
    return next;
  }

  const isTimeline = event.relType === null || event.relType === "reply";

  if (idGreaterThan(event.id, next.lastEventId) && isTimeline) {
    next = { ...next, lastEventId: event.id };
  }

  if (event.relatesToId !== null && (event.relType === "edit" || event.relType === "reaction")) {
    next = withRelations(next, [event]);
    return next;
  }

  if (!isTimeline) {
    return next;
  }

  if (!next.atLatest) {
    // Not viewing the newest page: just track that something new exists.
    return next;
  }

  next = {
    ...next,
    eventIds: [...next.eventIds, event.id],
    eventsById: { ...next.eventsById, [event.id]: event },
  };
  next = trimWindow(next, "after");
  return next;
}

/**
 * Apply an EVENT_REDACT: `ids` are the primary redacted event and any
 * relations that targeted it. A redacted timeline event is tombstoned
 * ("This message was deleted.") only while a loaded reply still targets
 * it; otherwise it is removed from the window entirely. A redacted
 * relation is removed from its target's aggregate.
 */
export function applyEventRedact(channel: ChannelMessagesState, ids: string[]): ChannelMessagesState {
  let next = channel;
  const idSet = new Set(ids);

  // Remove redacted relations from every target's relation list.
  const relationsByTarget: Record<string, EventJson[]> = {};
  for (const [target, relations] of Object.entries(next.relationsByTarget)) {
    const kept = relations.filter((r) => !idSet.has(r.id));
    if (kept.length > 0) {
      relationsByTarget[target] = kept;
    }
  }
  next = { ...next, relationsByTarget };

  const stillReferenced = (eventId: string): boolean =>
    next.eventIds.some((id) => {
      const candidate = next.eventsById[id];
      return candidate?.relType === "reply" && candidate.relatesToId === eventId;
    });

  let eventIds = next.eventIds;
  let eventsById = next.eventsById;
  let changed = false;
  for (const id of ids) {
    const event = eventsById[id];
    if (!event) continue;
    const isTimeline = event.relType === null || event.relType === "reply";
    if (!isTimeline) continue;
    if (stillReferenced(id)) {
      if (!event.redactedAt) {
        eventsById = { ...eventsById, [id]: { ...event, redactedAt: new Date().toISOString(), ciphertext: "" } };
        changed = true;
      }
    } else {
      eventIds = eventIds.filter((existing) => existing !== id);
      const { [id]: _removed, ...rest } = eventsById;
      eventsById = rest;
      changed = true;
    }
  }
  if (changed) {
    next = { ...next, eventIds, eventsById };
  }
  return next;
}

// ---- pending sends ----------------------------------------------------------

export function addPending(channel: ChannelMessagesState, pending: PendingMessage): ChannelMessagesState {
  return { ...channel, pending: [...channel.pending, pending] };
}

export function markPendingFailed(channel: ChannelMessagesState, nonce: string): ChannelMessagesState {
  return {
    ...channel,
    pending: channel.pending.map((p) => (p.nonce === nonce ? { ...p, state: "failed" } : p)),
  };
}

export function markPendingSending(channel: ChannelMessagesState, nonce: string): ChannelMessagesState {
  return {
    ...channel,
    pending: channel.pending.map((p) => (p.nonce === nonce ? { ...p, state: "sending" } : p)),
  };
}

export function removePending(channel: ChannelMessagesState, nonce: string): ChannelMessagesState {
  return { ...channel, pending: channel.pending.filter((p) => p.nonce !== nonce) };
}

/**
 * Reconcile a POST response with the live-event stream: if EVENT_CREATE
 * for this id already landed (and already dropped the pending entry by
 * nonce), there is nothing left to do here. Otherwise, add the event and
 * drop the pending entry now.
 */
export function reconcilePosted(channel: ChannelMessagesState, event: EventJson): ChannelMessagesState {
  if (event.id in channel.eventsById) {
    return removePending(channel, event.nonce);
  }
  return applyEventCreate(channel, event);
}

// ---- payload decode cache ----------------------------------------------------

export function setPayload(
  channel: ChannelMessagesState,
  eventId: string,
  payload: DecryptedPayload | null,
): ChannelMessagesState {
  return { ...channel, payloads: { ...channel.payloads, [eventId]: payload } };
}

// ---- stale refetch -------------------------------------------------------------

/** After a fresh READY (not RESUMED), every open window must be marked stale. */
export function markAllStale(channels: Record<string, ChannelMessagesState>): Record<string, ChannelMessagesState> {
  const next: Record<string, ChannelMessagesState> = {};
  for (const [id, channel] of Object.entries(channels)) {
    next[id] = { ...channel, stale: true };
  }
  return next;
}

/** Whether the visible channel's window needs a latest-page refetch right now. */
export function needsStaleRefetch(channel: ChannelMessagesState | undefined): boolean {
  return channel?.stale === true;
}

/**
 * Seed a channel's `lastEventId`/`lastReadEventId` baseline from READY or
 * GUILD_CREATE, without disturbing any window already loaded for it. This
 * is what lets an unread badge show for a channel the user has not opened
 * this session.
 */
export function seedChannelBaseline(
  channels: Record<string, ChannelMessagesState>,
  channelId: string,
  lastEventId: string | null,
  lastReadEventId: string | null,
): Record<string, ChannelMessagesState> {
  const existing = channels[channelId] ?? createChannelMessagesState();
  const nextLastEventId = idGreaterThan(lastEventId, existing.lastEventId) ? lastEventId : existing.lastEventId;
  const nextLastReadEventId = idGreaterThan(lastReadEventId, existing.lastReadEventId)
    ? lastReadEventId
    : existing.lastReadEventId;
  if (nextLastEventId === existing.lastEventId && nextLastReadEventId === existing.lastReadEventId) {
    return channels;
  }
  return { ...channels, [channelId]: { ...existing, lastEventId: nextLastEventId, lastReadEventId: nextLastReadEventId } };
}

// ---- unread and mentions --------------------------------------------------------

export function isChannelUnread(lastEventId: string | null, lastReadEventId: string | null): boolean {
  return idGreaterThan(lastEventId, lastReadEventId);
}

/** Count decoded, non-deleted messages after the read marker that mention `selfUserId`. */
export function countMentions(channel: ChannelMessagesState, selfUserId: string | null): number {
  if (!selfUserId) {
    return 0;
  }
  let count = 0;
  for (const id of channel.eventIds) {
    if (channel.lastReadEventId !== null && !idGreaterThan(id, channel.lastReadEventId)) {
      continue;
    }
    const event = channel.eventsById[id];
    if (!event || event.redactedAt) {
      continue;
    }
    const payload = channel.payloads[id];
    if (!payload || payload.type === "reaction") {
      continue;
    }
    if (payload.mentions.includes(selfUserId)) {
      count += 1;
    }
  }
  return count;
}

export interface GuildUnreadSummary {
  /** True when at least one of the given channels has unread messages. */
  hasUnread: boolean;
  /** The sum of mention counts across the given channels. */
  mentionCount: number;
}

/**
 * Roll up unread and mention state for one guild, from a list of its
 * viewable text channel ids. The caller filters `channelIds` to the
 * channels the user can view (the server already does this for the
 * channels it sends), so this function only sums what it is given.
 */
export function aggregateGuildUnread(
  channels: Record<string, ChannelMessagesState>,
  channelIds: string[],
  selfUserId: string | null,
): GuildUnreadSummary {
  let hasUnread = false;
  let mentionCount = 0;
  for (const id of channelIds) {
    const channel = channels[id];
    if (!channel) continue;
    if (isChannelUnread(channel.lastEventId, channel.lastReadEventId)) {
      hasUnread = true;
    }
    mentionCount += countMentions(channel, selfUserId);
  }
  return { hasUnread, mentionCount };
}

/** Format a badge count for display, capped at "99+" so the pill stays small. */
export function formatBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

// ---- read state ------------------------------------------------------------------

/** Move the local read marker forward. Never moves it back (mirrors the server rule). */
export function advanceReadMarker(channel: ChannelMessagesState, eventId: string): ChannelMessagesState {
  if (idGreaterThan(eventId, channel.lastReadEventId) || channel.lastReadEventId === null) {
    return { ...channel, lastReadEventId: eventId };
  }
  return channel;
}

// ---- typing ------------------------------------------------------------------

export function setTypingStart(channel: ChannelMessagesState, userId: string, now: number): ChannelMessagesState {
  return { ...channel, typing: { ...channel.typing, [userId]: now + TYPING_TIMEOUT_MS } };
}

/** Clear a user's typing indicator once one of their messages arrives. */
export function clearTypingForSender(channel: ChannelMessagesState, userId: string): ChannelMessagesState {
  if (!(userId in channel.typing)) {
    return channel;
  }
  const { [userId]: _removed, ...rest } = channel.typing;
  return { ...channel, typing: rest };
}

/** Drop every typing entry whose timeout has passed. */
export function expireTyping(channel: ChannelMessagesState, now: number): ChannelMessagesState {
  const typing: Record<string, number> = {};
  let changed = false;
  for (const [userId, expiresAt] of Object.entries(channel.typing)) {
    if (expiresAt > now) {
      typing[userId] = expiresAt;
    } else {
      changed = true;
    }
  }
  return changed ? { ...channel, typing } : channel;
}

export function shouldSendTyping(channel: ChannelMessagesState, now: number): boolean {
  return now - channel.lastTypingSentAt >= TYPING_SEND_INTERVAL_MS;
}

export function markTypingSent(channel: ChannelMessagesState, now: number): ChannelMessagesState {
  return { ...channel, lastTypingSentAt: now };
}

// ---- top-level state and LRU -------------------------------------------------------

export interface MessagesState {
  selfUserId: string | null;
  channels: Record<string, ChannelMessagesState>;
  /** Channel ids, most recently used last, for the ~20-channel cache limit. */
  channelOrder: string[];
}

export function createInitialMessagesState(): MessagesState {
  return { selfUserId: null, channels: {}, channelOrder: [] };
}

/** Touch a channel as most-recently-used, evicting the oldest once over the cap. */
export function touchChannel(state: MessagesState, channelId: string): MessagesState {
  const order = state.channelOrder.filter((id) => id !== channelId);
  order.push(channelId);
  let channels = state.channels;
  while (order.length > MAX_CACHED_CHANNELS) {
    const evicted = order.shift()!;
    if (evicted === channelId) continue;
    const { [evicted]: _removed, ...rest } = channels;
    channels = rest;
  }
  return { ...state, channelOrder: order, channels };
}

// ---- the store (I/O wrapper) --------------------------------------------------

export interface MessagesStoreOptions {
  api: ApiClient;
  codec: PayloadCodec;
  send(op: number, d?: unknown): void;
  /** Wall clock, injected for tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Random nonce generator, injected for tests. */
  makeNonce?: () => string;
}

export interface MessagesActions {
  setSelfUserId(userId: string | null): void;
  openChannel(channelId: string, lastEventId: string | null, lastReadEventId: string | null): Promise<void>;
  loadOlder(channelId: string): Promise<void>;
  loadNewer(channelId: string): Promise<void>;
  jumpTo(channelId: string, eventId: string): Promise<void>;
  refetchLatest(channelId: string): Promise<void>;
  sendMessage(channelId: string, body: string, mentions: string[], relatesToId?: string): Promise<void>;
  retryPending(channelId: string, nonce: string): Promise<void>;
  discardPending(channelId: string, nonce: string): void;
  sendReaction(channelId: string, eventId: string, key: string): Promise<void>;
  removeOwnReaction(channelId: string, reactionEventId: string): Promise<void>;
  redact(channelId: string, eventId: string): Promise<void>;
  editMessage(channelId: string, eventId: string, body: string, mentions: string[]): Promise<void>;
  markRead(channelId: string, eventId: string): void;
  notifyTyping(channelId: string): void;
  applyDispatch(t: string, d: unknown): void;
  tickTyping(channelId: string): void;
}

export type MessagesStore = MessagesState & MessagesActions;

let nonceCounter = 0;
function defaultMakeNonce(): string {
  nonceCounter += 1;
  return `${Date.now()}-${nonceCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createMessagesStore(options: MessagesStoreOptions): StoreApi<MessagesStore> {
  const { api, codec } = options;
  const now = options.now ?? (() => Date.now());
  const makeNonce = options.makeNonce ?? defaultMakeNonce;
  const readTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function updateChannel(
    get: () => MessagesStore,
    set: (partial: Partial<MessagesStore>) => void,
    channelId: string,
    fn: (channel: ChannelMessagesState) => ChannelMessagesState,
  ): ChannelMessagesState {
    const state = get();
    const current = state.channels[channelId] ?? createChannelMessagesState();
    const next = fn(current);
    // Skip the store update when nothing changed (for example, a typing
    // tick that expired no one): this keeps idle CPU use low, since a
    // pointless update would still wake every subscriber.
    if (next !== current) {
      set({ channels: { ...state.channels, [channelId]: next } });
    }
    return next;
  }

  async function decodeAndStore(
    get: () => MessagesStore,
    set: (partial: Partial<MessagesStore>) => void,
    channelId: string,
    events: EventJson[],
  ): Promise<void> {
    for (const event of events) {
      if (event.redactedAt) continue;
      const result = await codec.decode(event);
      updateChannel(get, set, channelId, (channel) =>
        setPayload(channel, event.id, result.ok ? result.payload : null),
      );
    }
  }

  const store = createStore<MessagesStore>((set, get) => ({
    ...createInitialMessagesState(),

    setSelfUserId(userId) {
      set({ selfUserId: userId });
    },

    async openChannel(channelId, lastEventId, lastReadEventId) {
      set(touchChannel(get(), channelId));
      const page = await messagesApi.listEvents(api, channelId, { limit: 50 });
      updateChannel(get, set, channelId, (channel) => {
        const withMeta: ChannelMessagesState = { ...channel, lastEventId, lastReadEventId, atLatest: true };
        return loadPage(withMeta, page, "initial");
      });
      await decodeAndStore(get, set, channelId, [...page.events, ...page.relations]);
    },

    async loadOlder(channelId) {
      const channel = get().channels[channelId];
      if (!channel || channel.eventIds.length === 0 || !channel.hasMoreBefore) {
        return;
      }
      const oldest = channel.eventIds[0]!;
      const page = await messagesApi.listEvents(api, channelId, { before: oldest, limit: 50 });
      updateChannel(get, set, channelId, (c) => loadPage(c, page, "before"));
      await decodeAndStore(get, set, channelId, [...page.events, ...page.relations]);
    },

    async loadNewer(channelId) {
      const channel = get().channels[channelId];
      if (!channel || channel.eventIds.length === 0 || !channel.hasMoreAfter) {
        return;
      }
      const newest = channel.eventIds[channel.eventIds.length - 1]!;
      const page = await messagesApi.listEvents(api, channelId, { after: newest, limit: 50 });
      updateChannel(get, set, channelId, (c) => {
        const merged = loadPage(c, page, "after");
        return { ...merged, atLatest: !merged.hasMoreAfter };
      });
      await decodeAndStore(get, set, channelId, [...page.events, ...page.relations]);
    },

    async jumpTo(channelId, eventId) {
      const page = await messagesApi.listEvents(api, channelId, { around: eventId, limit: 50 });
      let atLatest = false;
      updateChannel(get, set, channelId, (c) => {
        const next = jumpToPage(c, page);
        atLatest = !next.hasMoreAfter;
        return { ...next, atLatest };
      });
      await decodeAndStore(get, set, channelId, [...page.events, ...page.relations]);
    },

    async refetchLatest(channelId) {
      const page = await messagesApi.listEvents(api, channelId, { limit: 50 });
      updateChannel(get, set, channelId, (c) => {
        const fresh = createChannelMessagesState();
        const next = loadPage(
          { ...fresh, lastEventId: c.lastEventId, lastReadEventId: c.lastReadEventId, pending: c.pending },
          page,
          "initial",
        );
        return { ...next, atLatest: true };
      });
      await decodeAndStore(get, set, channelId, [...page.events, ...page.relations]);
    },

    async sendMessage(channelId, body, mentions, relatesToId) {
      const nonce = makeNonce();
      const pending: PendingMessage = {
        nonce,
        channelId,
        body,
        mentions,
        relType: relatesToId ? "reply" : undefined,
        relatesToId,
        createdAt: new Date(now()).toISOString(),
        state: "sending",
      };
      updateChannel(get, set, channelId, (c) => addPending(c, pending));
      try {
        const encoded = await codec.encode(channelId, {
          type: "message",
          body,
          mentions,
          attachments: [],
          embeds: [],
        });
        const event = await messagesApi.postEvent(api, channelId, {
          relType: relatesToId ? "reply" : undefined,
          relatesToId,
          codec: encoded.codec as "plain-v1" | "megolm-v1",
          megolmSessionId: encoded.megolmSessionId ?? undefined,
          ciphertext: encodeBase64Url(encoded.ciphertext),
          nonce,
        });
        updateChannel(get, set, channelId, (c) => reconcilePosted(c, event));
        await decodeAndStore(get, set, channelId, [event]);
      } catch {
        updateChannel(get, set, channelId, (c) => markPendingFailed(c, nonce));
      }
    },

    async retryPending(channelId, nonce) {
      const channel = get().channels[channelId];
      const pending = channel?.pending.find((p) => p.nonce === nonce);
      if (!pending) return;
      updateChannel(get, set, channelId, (c) => markPendingSending(c, nonce));
      try {
        const encoded = await codec.encode(channelId, {
          type: "message",
          body: pending.body,
          mentions: pending.mentions,
          attachments: [],
          embeds: [],
        });
        const event = await messagesApi.postEvent(api, channelId, {
          relType: pending.relType,
          relatesToId: pending.relatesToId,
          codec: encoded.codec as "plain-v1" | "megolm-v1",
          megolmSessionId: encoded.megolmSessionId ?? undefined,
          ciphertext: encodeBase64Url(encoded.ciphertext),
          nonce,
        });
        updateChannel(get, set, channelId, (c) => reconcilePosted(c, event));
        await decodeAndStore(get, set, channelId, [event]);
      } catch {
        updateChannel(get, set, channelId, (c) => markPendingFailed(c, nonce));
      }
    },

    discardPending(channelId, nonce) {
      updateChannel(get, set, channelId, (c) => removePending(c, nonce));
    },

    async sendReaction(channelId, eventId, key) {
      const encoded = await codec.encode(channelId, { type: "reaction", key });
      const event = await messagesApi.postEvent(api, channelId, {
        relType: "reaction",
        relatesToId: eventId,
        codec: encoded.codec as "plain-v1" | "megolm-v1",
        megolmSessionId: encoded.megolmSessionId ?? undefined,
        ciphertext: encodeBase64Url(encoded.ciphertext),
        nonce: makeNonce(),
      });
      updateChannel(get, set, channelId, (c) => withRelations(c, [event]));
      await decodeAndStore(get, set, channelId, [event]);
    },

    async removeOwnReaction(channelId, reactionEventId) {
      await messagesApi.redactEvent(api, channelId, reactionEventId);
      updateChannel(get, set, channelId, (c) => applyEventRedact(c, [reactionEventId]));
    },

    async redact(channelId, eventId) {
      await messagesApi.redactEvent(api, channelId, eventId);
      updateChannel(get, set, channelId, (c) => applyEventRedact(c, [eventId]));
    },

    async editMessage(channelId, eventId, body, mentions) {
      const encoded = await codec.encode(channelId, { type: "edit", body, mentions });
      const event = await messagesApi.postEvent(api, channelId, {
        relType: "edit",
        relatesToId: eventId,
        codec: encoded.codec as "plain-v1" | "megolm-v1",
        megolmSessionId: encoded.megolmSessionId ?? undefined,
        ciphertext: encodeBase64Url(encoded.ciphertext),
        nonce: makeNonce(),
      });
      updateChannel(get, set, channelId, (c) => withRelations(c, [event]));
      await decodeAndStore(get, set, channelId, [event]);
    },

    markRead(channelId, eventId) {
      updateChannel(get, set, channelId, (c) => advanceReadMarker(c, eventId));
      const existing = readTimers.get(channelId);
      if (existing) clearTimeout(existing);
      readTimers.set(
        channelId,
        setTimeout(() => {
          readTimers.delete(channelId);
          const channel = get().channels[channelId];
          if (channel?.lastReadEventId) {
            void messagesApi.updateReadState(api, channelId, channel.lastReadEventId).catch(() => {
              // A dropped PUT is not fatal: the next markRead call retries it.
            });
          }
        }, READ_STATE_DEBOUNCE_MS),
      );
    },

    notifyTyping(channelId) {
      const channel = get().channels[channelId] ?? createChannelMessagesState();
      const t = now();
      if (!shouldSendTyping(channel, t)) {
        return;
      }
      updateChannel(get, set, channelId, (c) => markTypingSent(c, t));
      options.send(GatewayOpcode.TYPING, { channelId });
    },

    tickTyping(channelId) {
      updateChannel(get, set, channelId, (c) => expireTyping(c, now()));
    },

    applyDispatch(t, d) {
      const state = get();
      switch (t) {
        case "READY": {
          const payload = d as {
            guilds: Array<{ channels: Array<{ id: string; lastEventId: string | null }> }>;
            readStates: Array<{ channelId: string; lastReadEventId: string | null }>;
          };
          const readByChannel = new Map(payload.readStates.map((r) => [r.channelId, r.lastReadEventId]));
          let channels = markAllStale(state.channels);
          for (const guild of payload.guilds) {
            for (const channel of guild.channels) {
              channels = seedChannelBaseline(channels, channel.id, channel.lastEventId, readByChannel.get(channel.id) ?? null);
            }
          }
          set({ channels });
          return;
        }
        case "GUILD_CREATE": {
          const payload = d as { channels: Array<{ id: string; lastEventId: string | null }> };
          let channels = state.channels;
          for (const channel of payload.channels) {
            channels = seedChannelBaseline(channels, channel.id, channel.lastEventId, null);
          }
          set({ channels });
          return;
        }
        case "EVENT_CREATE": {
          const event = d as EventJson;
          // Track lastEventId, unread and mentions even for a channel whose
          // window was never opened: this only reads events received while
          // connected, and never triggers a history fetch.
          const channel = state.channels[event.channelId] ?? createChannelMessagesState();
          let next = applyEventCreate(channel, event);
          if (event.relType === null || event.relType === "reply") {
            next = clearTypingForSender(next, event.senderId);
          }
          set({ channels: { ...state.channels, [event.channelId]: next } });
          void decodeAndStore(get, set, event.channelId, [event]);
          return;
        }
        case "EVENT_REDACT": {
          const payload = d as { channelId: string; ids: string[] };
          const channel = state.channels[payload.channelId];
          if (!channel) return;
          set({
            channels: {
              ...state.channels,
              [payload.channelId]: applyEventRedact(channel, payload.ids),
            },
          });
          return;
        }
        case "TYPING_START": {
          const payload = d as { channelId: string; userId: string };
          const channel = state.channels[payload.channelId];
          if (!channel) return;
          set({
            channels: {
              ...state.channels,
              [payload.channelId]: setTypingStart(channel, payload.userId, now()),
            },
          });
          return;
        }
        case "READ_STATE_UPDATE": {
          const payload = d as { channelId: string; lastReadEventId: string | null };
          if (payload.lastReadEventId === null) return;
          const channel = state.channels[payload.channelId] ?? createChannelMessagesState();
          set({
            channels: {
              ...state.channels,
              [payload.channelId]: advanceReadMarker(channel, payload.lastReadEventId),
            },
          });
          return;
        }
        default:
          return;
      }
    },
  }));

  return store;
}
