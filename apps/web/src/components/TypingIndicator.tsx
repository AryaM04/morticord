// Shows who is typing in the current channel, under the composer.
import { useEffect } from "react";
import { useMessages } from "../lib/useMessages.js";
import { useRealtime } from "../lib/useRealtime.js";
import { displayNameOf } from "../lib/members.js";
import { messagesStore } from "../lib/messages.js";

export function TypingIndicator({ channelId, guildId }: { channelId: string; guildId: string }) {
  const typing = useMessages((s) => s.channels[channelId]?.typing ?? {});
  const state = useRealtime((s) => s);
  const userIds = Object.keys(typing);

  // Expire stale entries on a slow timer, so the line clears itself
  // without waiting for the next gateway message.
  useEffect(() => {
    const timer = setInterval(() => messagesStore.getState().tickTyping(channelId), 1_000);
    return () => clearInterval(timer);
  }, [channelId]);

  if (userIds.length === 0) {
    return <div className="h-5" />;
  }

  const names = userIds.map((id) => displayNameOf(state, guildId, id));
  let text: string;
  if (names.length === 1) {
    text = `${names[0]} is typing…`;
  } else if (names.length === 2) {
    text = `${names[0]} and ${names[1]} are typing…`;
  } else {
    text = "Several people are typing…";
  }

  return (
    <div className="h-5 truncate px-4 text-xs" style={{ color: "var(--color-text-muted)" }}>
      {text}
    </div>
  );
}
