// The main pane: a channel header and its content. A text channel shows
// its message list and composer; a voice channel shows a placeholder
// (voice itself arrives in M4).
import { useEffect, useMemo, useState } from "react";
import type { AggregatedMessage } from "@discord-clone/client-core";
import { Permission, hasPermission } from "@discord-clone/shared";
import { ConnectionBanner } from "./ConnectionBanner.js";
import { Composer, type EditTarget, type ReplyTarget } from "./Composer.js";
import { MessageList } from "./MessageList.js";
import { TypingIndicator } from "./TypingIndicator.js";
import { useRealtime } from "../lib/useRealtime.js";
import { useMessages } from "../lib/useMessages.js";
import { messagesStore } from "../lib/messages.js";
import { selfChannelPermissions } from "@discord-clone/client-core";
import { displayNameOf } from "../lib/members.js";

export function ChatPane({ channelId }: { channelId: string | null }) {
  const channel = useRealtime((s) => (channelId ? s.channels[channelId] : undefined));
  const realtimeState = useRealtime((s) => s);
  const messagesState = useMessages((s) => s);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  const permissions = channelId ? selfChannelPermissions(realtimeState, channelId) : 0n;
  const canSend = hasPermission(permissions, Permission.SEND_MESSAGES);
  const canManageMessages = hasPermission(permissions, Permission.MANAGE_MESSAGES);

  useEffect(() => {
    setReplyTarget(null);
    setEditTarget(null);
    if (channelId && channel?.type === "text") {
      void messagesStore.getState().openChannel(channelId, channel.lastEventId, null);
    }
  }, [channelId, channel?.type]);

  // Mark the channel read once its window catches up to the newest
  // message: this only fires when the tab has focus and the view is at
  // the bottom, per the `markRead` debounce in the store.
  const channelState = channelId ? messagesState.channels[channelId] : undefined;
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
        <div className="flex flex-1 flex-col items-center justify-center p-3 text-center">
          <p style={{ color: "var(--color-text-muted)" }}>Voice is not available yet.</p>
        </div>
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
