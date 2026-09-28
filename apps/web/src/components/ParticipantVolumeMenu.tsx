// A small menu for one other voice participant: a volume slider (0% to
// 200%) and "Mute for me". Opens on right-click on the participant row,
// or on a keyboard-reachable menu button, so the same control works
// without a mouse. Never shown for the self user.
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { applyPeerVolume } from "../lib/voice.js";
import { getPerUserVoiceSetting, perUserVoiceStore, setUserVolumeSetting, toggleMutedForMe } from "../lib/voice-settings.js";

export function useParticipantMenu() {
  const [openForUserId, setOpenForUserId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  function openAt(userId: string, x: number, y: number) {
    setOpenForUserId(userId);
    setAnchor({ x, y });
  }
  function onContextMenu(event: React.MouseEvent, userId: string) {
    event.preventDefault();
    openAt(userId, event.clientX, event.clientY);
  }
  function close() {
    setOpenForUserId(null);
    setAnchor(null);
  }

  return { openForUserId, anchor, openAt, onContextMenu, close };
}

export function ParticipantVolumeMenu({
  userId,
  anchor,
  onClose,
}: {
  userId: string;
  anchor: { x: number; y: number };
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const setting = useStore(perUserVoiceStore, () => getPerUserVoiceSetting(userId));

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const percent = Math.round(setting.volume * 100);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Volume for this person"
      className="fixed z-50 w-56 rounded border p-3 shadow-lg"
      style={{
        left: anchor.x,
        top: anchor.y,
        backgroundColor: "var(--color-bg-main)",
        borderColor: "var(--color-border)",
        color: "var(--color-text-primary)",
      }}
    >
      <label className="mb-1 block text-xs" htmlFor={`volume-${userId}`}>
        Volume: {percent}%
      </label>
      <input
        id={`volume-${userId}`}
        type="range"
        min={0}
        max={200}
        step={5}
        value={percent}
        disabled={setting.mutedForMe}
        onChange={(event) =>
          setUserVolumeSetting(userId, Number(event.target.value) / 100, applyPeerVolume)
        }
        className="w-full"
      />
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={setting.mutedForMe}
        onClick={() => toggleMutedForMe(userId, applyPeerVolume)}
        className="mt-3 w-full rounded px-2 py-1.5 text-left text-sm"
        style={{ backgroundColor: "var(--color-bg-sidebar)" }}
      >
        {setting.mutedForMe ? "Unmute for me" : "Mute for me"}
      </button>
    </div>
  );
}
