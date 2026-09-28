// The main pane: a channel header and its content. A text channel shows
// its message list and composer; a voice channel shows a short notice
// here, since a voice channel is joined from the channel list, not from
// this pane (see ChannelColumn and the voice status panel above the
// user panel).
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { needsStaleRefetch, type AggregatedMessage } from "@discord-clone/client-core";
import { Permission, hasPermission } from "@discord-clone/shared";
import { ConnectionBanner } from "./ConnectionBanner.js";
import { Composer, type EditTarget, type ReplyTarget } from "./Composer.js";
import { MessageList } from "./MessageList.js";
import { TypingIndicator } from "./TypingIndicator.js";
import { VoiceCallView } from "./VoiceCallView.js";
import { useRealtime } from "../lib/useRealtime.js";
import { useMessages } from "../lib/useMessages.js";
import { messagesStore } from "../lib/messages.js";
import { selfChannelPermissions } from "@discord-clone/client-core";
import { displayNameOf } from "../lib/members.js";
import { voiceStore } from "../lib/voice.js";

export function ChatPane({ channelId }: { channelId: string | null }) {
  const channel = useRealtime((s) => (channelId ? s.channels[channelId] : undefined));
  const realtimeState = useRealtime((s) => s);
  const messagesState = useMessages((s) => s);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  const permissions = channelId ? selfChannelPermissions(realtimeState, channelId) : 0n;
  const canSend = hasPermission(permissions, Permission.SEND_MESSAGES);
  const canManageMessages = hasPermission(permissions, Permission.MANAGE_MESSAGES);

  const channelState = channelId ? messagesState.channels[channelId] : undefined;
  const connectedVoiceChannelId = useStore(voiceStore, (s) => (s.status === "connected" ? s.channelId : null));

  useEffect(() => {
    setReplyTarget(null);
    setEditTarget(null);
    if (channelId && channel?.type === "text") {
      // A fresh READY (see `applyDispatch` in the store) already seeds
      // this channel's read marker before this effect runs, so read it
      // from the store instead of passing `null`: passing `null` would
      // wipe out the marker and break the unread and mention badges as
      // soon as the channel is opened.
      const seededReadId = messagesStore.getState().channels[channelId]?.lastReadEventId ?? null;
      void messagesStore.getState().openChannel(channelId, channel.lastEventId, seededReadId);
    }
  }, [channelId, channel?.type]);

  // A gateway reconnect that gets a fresh READY (not a RESUMED) marks
  // every cached channel window `stale`, because a fresh READY carries
  // no guarantee that no event was missed while disconnected. Refetch
  // the currently open channel's latest page when that happens, so its
  // messages do not silently fall behind.
  useEffect(() => {
    if (channelId && needsStaleRefetch(channelState)) {
      void messagesStore.getState().refetchLatest(channelId);
    }
  }, [channelId, channelState?.stale]);

  // Mark the channel read once its window catches up to the newest
  // message: this only fires when the tab has focus and the view is at
  // the bottom, per the `markRead` debounce in the store.
  useEffect(() => {
    if (!channelId || !channelState || !document.hasFocus() || !channelState.atLatest) {
      return;
    }
    const newest = channelState.eventIds[channelState.eventIds.length - 1];
    if (newest) {
      messagesStore.getState().markRead(channelId, newest);
    }
  }, [channelId, channelState?.eventIds.length, channelState?.atLatest]);

  const lastOwnMessageId = useMemo(() => {
    if (!channelState) return null;
    for (let i = channelState.eventIds.length - 1; i >= 0; i -= 1) {
      const id = channelState.eventIds[i]!;
      const event = channelState.eventsById[id];
      if (event && event.senderId === messagesState.selfUserId && !event.redactedAt) {
        return event;
      }
    }
    return null;
  }, [channelState, messagesState.selfUserId]);

  if (!channelId || !channel) {
    return (
      <div className="flex flex-1 flex-col" style={{ backgroundColor: "var(--color-bg-main)" }}>
        <ConnectionBanner />
        <div className="flex flex-1 items-center justify-center" style={{ color: "var(--color-text-muted)" }}>
          Choose a channel to start.
        </div>
      </div>
    );
  }

  function startReply(message: AggregatedMessage): void {
    setEditTarget(null);
    setReplyTarget({ id: message.id, authorName: displayNameOf(realtimeState, channel!.guildId, message.senderId), preview: message.body });
  }

  function startEdit(message: AggregatedMessage): void {
    setReplyTarget(null);
    setEditTarget({ id: message.id, body: message.body });
  }

  return (
    <div className="flex flex-1 flex-col" style={{ backgroundColor: "var(--color-bg-main)" }}>
      <ConnectionBanner />
      <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--color-border)" }}>
        <span className="font-semibold">
          {channel.type === "voice" ? "\u{1F50A}" : "#"} {channel.name}
        </span>
        {channel.topic && (
          <span className="truncate text-sm" style={{ color: "var(--color-text-muted)" }}>
            {channel.topic}
          </span>
        )}
      </div>

      {channel.type === "voice" ? (
        connectedVoiceChannelId === channelId ? (
          <VoiceCallView guildId={channel.guildId} channelId={channelId} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-3 text-center">
            <p style={{ color: "var(--color-text-muted)" }}>
              Click this channel in the list on the left to join the voice call.
            </p>
          </div>
        )
      ) : (
        <>
          <MessageList
            channelId={channelId}
            guildId={channel.guildId}
            canManageMessages={canManageMessages}
            onReply={startReply}
            onEdit={startEdit}
          />
          <TypingIndicator channelId={channelId} guildId={channel.guildId} />
          <Composer
            channelId={channelId}
            guildId={channel.guildId}
            canSend={canSend}
            disabledReason="You do not have permission to send a message here."
            replyTarget={replyTarget}
            onCancelReply={() => setReplyTarget(null)}
            editTarget={editTarget}
            onCancelEdit={() => setEditTarget(null)}
            onRequestEditLast={() => {
              if (lastOwnMessageId) {
                const relations = channelState?.relationsByTarget[lastOwnMessageId.id] ?? [];
                const payloads = channelState?.payloads ?? {};
                const body =
                  payloads[lastOwnMessageId.id] && payloads[lastOwnMessageId.id]?.type !== "reaction"
                    ? (payloads[lastOwnMessageId.id] as { body: string }).body
                    : "";
                void relations;
                setEditTarget({ id: lastOwnMessageId.id, body });
              }
            }}
          />
        </>
      )}
    </div>
  );
}
