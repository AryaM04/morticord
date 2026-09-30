// A hidden live region. It tells a screen reader about a new message from
// another user in the open channel. The message list is virtual, so the list
// itself cannot be a live region.
import { useEffect, useRef, useState } from "react";
import { useMessages } from "../lib/useMessages.js";
import { messagesStore } from "../lib/messages.js";
import { realtimeStore } from "../lib/realtime.js";
import { displayNameOf } from "../lib/members.js";

export function MessageAnnouncer({ channelId, guildId }: { channelId: string; guildId: string | null }) {
  const lastId = useMessages((s) => {
    const channel = s.channels[channelId];
    return channel?.atLatest ? (channel.eventIds[channel.eventIds.length - 1] ?? null) : null;
  });
  const [text, setText] = useState("");
  // The newest event that this component has seen. A change after the first one is a new message.
  const seenRef = useRef<{ channelId: string; id: string | null } | null>(null);

  useEffect(() => {
    const seen = seenRef.current;
    seenRef.current = { channelId, id: lastId };
    setText("");
    if (!lastId || !seen || seen.channelId !== channelId || seen.id === null || seen.id === lastId) {
      return;
    }
    const state = messagesStore.getState();
    const event = state.channels[channelId]?.eventsById[lastId];
    if (!event || event.senderId === state.selfUserId) {
      return;
    }
    const payload = state.channels[channelId]?.payloads[lastId];
    if (payload && payload.type !== "message") {
      return;
    }
    const name = displayNameOf(realtimeStore.getState(), guildId, event.senderId);
    setText(payload ? `${name}: ${payload.body}` : `New message from ${name}.`);
  }, [channelId, guildId, lastId]);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {text}
    </div>
  );
}
