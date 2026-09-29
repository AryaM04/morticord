// The scrolling message list: the reverse-chat Virtuoso pattern (newest
// at the bottom, older pages load as the user scrolls up), grouped by
// author, with day separators, a "New" divider at the read marker, and a
// button to jump back to the bottom once the user has scrolled away.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { aggregateEvent, type AggregatedMessage } from "@discord-clone/client-core";
import { useMessages } from "../lib/useMessages.js";
import { useRealtime } from "../lib/useRealtime.js";
import { messagesStore } from "../lib/messages.js";
import { displayNameOf, memberUser } from "../lib/members.js";
import { DayDivider, MessageItem, NewDivider, PendingMessageRow } from "./MessageItem.js";

const GROUP_WINDOW_MS = 7 * 60 * 1000;

type Row =
  | { kind: "day"; key: string; label: string }
  | { kind: "new"; key: string }
  | { kind: "message"; key: string; message: AggregatedMessage; showHeader: boolean }
  | { kind: "pending"; key: string; nonce: string; body: string; failed: boolean; error?: string };

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export function MessageList({
  channelId,
  guildId,
  canManageMessages,
  onReply,
  onEdit,
}: {
  channelId: string;
  /** Null for a DM. */
  guildId: string | null;
  canManageMessages: boolean;
  onReply: (message: AggregatedMessage) => void;
  onEdit: (message: AggregatedMessage) => void;
}) {
  const channel = useMessages((s) => s.channels[channelId]);
  const selfUserId = useMessages((s) => s.selfUserId);
  const realtimeState = useRealtime((s) => s);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether this channel has shown at least one row since it was opened.
  // Virtuoso is keyed on this (see below): mounting it fresh, already
  // holding data, is what a reverse-chat list needs for its first paint.
  // Handing an already-mounted Virtuoso an empty-to-full data jump (the
  // window loads asynchronously, so the first render always has zero
  // rows) can leave it showing nothing at all, because there is no prior
  // item position for it to scroll from or measure against.
  const [hasLoaded, setHasLoaded] = useState(false);
  // A stable, ever-decreasing index for the first loaded row, required
  // by react-virtuoso to prepend older pages correctly (its own docs
  // call this out for exactly this "load older history" pattern):
  // without it, Virtuoso cannot tell that row 0 after a prepend is a
  // different, older message than row 0 before it, and its scroll
  // anchoring and `startReached` re-arming both become unreliable.
  const FIRST_ITEM_INDEX_START = 1_000_000;
  const [firstItemIndex, setFirstItemIndex] = useState(FIRST_ITEM_INDEX_START);
  const oldestEventIdRef = useRef<string | null>(null);
  const rowCountRef = useRef(0);

  function highlightFor2s(id: string): void {
    setHighlightId(id);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightId(null), 2_000);
  }

  useEffect(() => () => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
  }, []);

  const getDisplayName = useCallback((userId: string) => displayNameOf(realtimeState, guildId, userId), [realtimeState, guildId]);

  const getReactorNames = useCallback(
    (userIds: string[]) => userIds.map((id) => getDisplayName(id)).join(", "),
    [getDisplayName],
  );

  const rows: Row[] = useMemo(() => {
    if (!channel) return [];
    const out: Row[] = [];
    let lastDay = "";
    let lastSenderId: string | null = null;
    let lastAt = 0;
    let newDividerShown = false;

    for (const id of channel.eventIds) {
      const event = channel.eventsById[id];
      if (!event) continue;
      const relations = channel.relationsByTarget[id] ?? [];
      const aggregated = aggregateEvent(event, relations, channel.payloads, selfUserId);

      const day = new Date(event.createdAt).toDateString();
      if (day !== lastDay) {
        out.push({ kind: "day", key: `day-${day}`, label: dayLabel(event.createdAt) });
        lastDay = day;
        lastSenderId = null;
      }

      if (
        !newDividerShown &&
        channel.lastReadEventId !== null &&
        BigInt(id) > BigInt(channel.lastReadEventId)
      ) {
        out.push({ kind: "new", key: "new-divider" });
        newDividerShown = true;
      }

      const at = new Date(event.createdAt).getTime();
      const showHeader = event.senderId !== lastSenderId || at - lastAt > GROUP_WINDOW_MS;
      out.push({ kind: "message", key: id, message: aggregated, showHeader });
      lastSenderId = event.senderId;
      lastAt = at;
    }

    for (const pending of channel.pending) {
      out.push({ kind: "pending", key: `pending-${pending.nonce}`, nonce: pending.nonce, body: pending.body, failed: pending.state === "failed", error: pending.error });
    }

    return out;
  }, [channel, selfUserId]);

  useEffect(() => {
    setHasLoaded(false);
    setFirstItemIndex(FIRST_ITEM_INDEX_START);
    oldestEventIdRef.current = null;
    rowCountRef.current = 0;
  }, [channelId]);

  useEffect(() => {
    if (rows.length > 0) {
      setHasLoaded(true);
    }
    const oldestEventId = channel?.eventIds[0] ?? null;
    if (
      oldestEventId !== null &&
      oldestEventIdRef.current !== null &&
      oldestEventId !== oldestEventIdRef.current
    ) {
      // The oldest loaded event changed to a different one: an older
      // page was prepended. Move the index back by however many rows
      // that added, so it keeps matching `data`'s new first row.
      const addedRows = rows.length - rowCountRef.current;
      if (addedRows > 0) {
        setFirstItemIndex((current) => current - addedRows);
      }
    }
    oldestEventIdRef.current = oldestEventId;
    rowCountRef.current = rows.length;
  }, [channel?.eventIds, rows.length]);

  if (!channel) {
    return null;
  }

  function replyPreviewFor(message: AggregatedMessage): { authorName: string; text: string } | null {
    if (message.relType !== "reply" || !message.relatesToId) {
      return null;
    }
    const target = channel!.eventsById[message.relatesToId];
    if (!target) {
      return { authorName: "", text: "Original message" };
    }
    const relations = channel!.relationsByTarget[message.relatesToId] ?? [];
    const targetAgg = aggregateEvent(target, relations, channel!.payloads, selfUserId);
    return { authorName: displayNameOf(realtimeState, guildId, target.senderId), text: targetAgg.body };
  }

  return (
    <div className="relative flex-1">
      <Virtuoso
        key={`${channelId}:${hasLoaded}`}
        ref={virtuosoRef}
        style={{ height: "100%" }}
        data={rows}
        // Start this fresh mount already scrolled to the newest message.
        // Without it, Virtuoso mounts scrolled to row 0 (the oldest
        // loaded message): with more history than fits on screen, that
        // reads as "at the top", so `startReached` fires immediately and
        // races older pages against `followOutput`'s scroll to the
        // bottom, leaving the view stranded somewhere in the middle.
        initialTopMostItemIndex={Math.max(0, rows.length - 1)}
        firstItemIndex={firstItemIndex}
        followOutput={atBottom ? "smooth" : false}
        atBottomStateChange={setAtBottom}
        startReached={() => void messagesStore.getState().loadOlder(channelId)}
        endReached={() => {
          if (!channel.atLatest) {
            void messagesStore.getState().loadNewer(channelId);
          }
        }}
        itemContent={(_, row) => {
          if (row.kind === "day") return <DayDivider label={row.label} />;
          if (row.kind === "new") return <NewDivider />;
          if (row.kind === "pending") {
            return (
              <PendingMessageRow
                body={row.body}
                failed={row.failed}
                error={row.error}
                onRetry={() => void messagesStore.getState().retryPending(channelId, row.nonce)}
                onDiscard={() => messagesStore.getState().discardPending(channelId, row.nonce)}
              />
            );
          }
          const message = row.message;
          const author = memberUser(realtimeState, guildId, message.senderId);
          return (
            <MessageItem
              message={message}
              showHeader={row.showHeader}
              author={author}
              authorName={displayNameOf(realtimeState, guildId, message.senderId)}
              isOwn={message.senderId === selfUserId}
              canManageMessages={canManageMessages}
              selfUserId={selfUserId}
              isHighlighted={highlightId === message.id}
              replyPreview={replyPreviewFor(message)}
              getDisplayName={getDisplayName}
              getReactorNames={getReactorNames}
              onReplyClick={() => {
                if (message.relatesToId) {
                  const target = message.relatesToId;
                  void messagesStore.getState().jumpTo(channelId, target).then(() => highlightFor2s(target));
                }
              }}
              onReply={() => onReply(message)}
              onEdit={() => onEdit(message)}
              onDelete={() => void messagesStore.getState().redact(channelId, message.id)}
              onToggleReaction={(key) => {
                const reaction = message.reactions.find((r) => r.key === key);
                if (reaction?.ownEventId) {
                  void messagesStore.getState().removeOwnReaction(channelId, reaction.ownEventId);
                } else {
                  void messagesStore.getState().sendReaction(channelId, message.id, key);
                }
              }}
              onAddReaction={(key) => void messagesStore.getState().sendReaction(channelId, message.id, key)}
            />
          );
        }}
      />
      {!atBottom && (
        <button
          type="button"
          onClick={() => {
            virtuosoRef.current?.scrollToIndex({ index: rows.length - 1, behavior: "smooth" });
          }}
          className="absolute bottom-3 right-4 rounded-full px-3 py-1 text-xs font-medium shadow"
          style={{ backgroundColor: "var(--color-accent)", color: "white" }}
        >
          Jump to present
        </button>
      )}
    </div>
  );
}
