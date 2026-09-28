// The voice status panel: shown above the user panel while a voice call
// is connecting or connected. It names the channel, gives a plain-word
// connection quality reading, and holds the mute, deafen and disconnect
// controls. See docs/concepts/voice.md for the call this panel controls.
import { useStore } from "zustand";
import { useRealtime } from "../lib/useRealtime.js";
import { leaveVoice, toggleDeafen, toggleMute, voiceStore } from "../lib/voice.js";

const QUALITY_LABEL: Record<string, string> = {
  good: "Good connection",
  poor: "Weak connection",
  connecting: "Connecting",
  lost: "Connection lost",
};

export function VoiceStatusPanel() {
  const status = useStore(voiceStore, (s) => s.status);
  const channelId = useStore(voiceStore, (s) => s.channelId);
  const muted = useStore(voiceStore, (s) => s.muted);
  const deafened = useStore(voiceStore, (s) => s.deafened);
  const quality = useStore(voiceStore, (s) => s.quality);
  const errorMessage = useStore(voiceStore, (s) => s.errorMessage);
  const channelName = useRealtime((s) => (channelId ? s.channels[channelId]?.name : undefined));

  if (status === "idle") {
    return errorMessage ? (
      <div className="border-t px-3 py-2 text-xs" style={{ borderColor: "var(--color-border)", color: "#e05252" }} role="alert">
        {errorMessage}
      </div>
    ) : null;
  }

  return (
    <div className="flex flex-col gap-1 border-t px-3 py-2" style={{ borderColor: "var(--color-border)" }}>
      <div className="flex flex-col">
        <span className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }} data-voice-status="connected">
          {status === "connecting" ? "Voice connecting" : "Voice connected"}
          {channelName ? `: ${channelName}` : ""}
        </span>
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }} data-voice-quality={quality}>
          {status === "connecting" ? "Connecting" : QUALITY_LABEL[quality]}
        </span>
      </div>
      {errorMessage && (
        <span className="text-xs" style={{ color: "#e05252" }} role="alert">
          {errorMessage}
        </span>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={toggleMute}
          aria-pressed={muted}
          data-voice-muted={muted}
          className="flex-1 rounded px-2 py-1 text-xs"
          style={{ backgroundColor: "var(--color-bg-main)", color: "var(--color-text-primary)" }}
        >
          {muted ? "Unmute" : "Mute"}
        </button>
        <button
          type="button"
          onClick={toggleDeafen}
          aria-pressed={deafened}
          data-voice-deafened={deafened}
          className="flex-1 rounded px-2 py-1 text-xs"
          style={{ backgroundColor: "var(--color-bg-main)", color: "var(--color-text-primary)" }}
        >
          {deafened ? "Undeafen" : "Deafen"}
        </button>
        <button
          type="button"
          onClick={() => void leaveVoice()}
          className="flex-1 rounded px-2 py-1 text-xs"
          style={{ backgroundColor: "#e05252", color: "white" }}
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
