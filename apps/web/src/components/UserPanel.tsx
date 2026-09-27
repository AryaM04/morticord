// The signed-in user's panel, at the bottom of the channel column.
import { useState } from "react";
import { Avatar } from "./Avatar.js";
import { SettingsDialog } from "./SettingsDialog.js";
import { useSession } from "../lib/useSession.js";

export function UserPanel() {
  const user = useSession((s) => s.user);
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!user) return null;

  return (
    <div
      className="flex items-center gap-2 border-t p-2"
      style={{ borderColor: "var(--color-border)" }}
    >
      <Avatar user={user} size={32} />
      <div className="flex-1 overflow-hidden">
        <div className="truncate text-sm font-medium">{user.displayName}</div>
        <div className="truncate text-xs" style={{ color: "var(--color-text-muted)" }}>
          @{user.username}
        </div>
      </div>
      <button
        type="button"
        aria-label="Open account settings"
        onClick={() => setSettingsOpen(true)}
        className="rounded px-2 py-1 text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        Settings
      </button>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
