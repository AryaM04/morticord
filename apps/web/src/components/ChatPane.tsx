// The main pane: a channel header and its content. Messages arrive in
// M3; for now a text channel shows an empty state, and a voice channel
// shows a placeholder (voice itself arrives in M4).
import { ConnectionBanner } from "./ConnectionBanner.js";
import { useRealtime } from "../lib/useRealtime.js";

export function ChatPane({ channelId }: { channelId: string | null }) {
  const channel = useRealtime((s) => (channelId ? s.channels[channelId] : undefined));

  return (
    <div className="flex flex-1 flex-col" style={{ backgroundColor: "var(--color-bg-main)" }}>
      <ConnectionBanner />
      {!channel ? (
        <div className="flex flex-1 items-center justify-center" style={{ color: "var(--color-text-muted)" }}>
          Choose a channel to start.
        </div>
      ) : (
        <>
          <div
            className="flex items-center gap-2 border-b px-4 py-3"
            style={{ borderColor: "var(--color-border)" }}
          >
            <span className="font-semibold">
              {channel.type === "voice" ? "\u{1F50A}" : "#"} {channel.name}
            </span>
            {channel.topic && (
              <span className="truncate text-sm" style={{ color: "var(--color-text-muted)" }}>
                {channel.topic}
              </span>
            )}
          </div>
          <div className="flex flex-1 flex-col items-center justify-center p-3 text-center">
            {channel.type === "voice" ? (
              <p style={{ color: "var(--color-text-muted)" }}>Voice is not available yet.</p>
            ) : (
              <p style={{ color: "var(--color-text-muted)" }}>This is the start of #{channel.name}.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
