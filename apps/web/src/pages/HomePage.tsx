// Shown at /app when there is no guild to return to yet.
import { useState } from "react";
import { CreateOrJoinGuildDialog } from "../components/CreateOrJoinGuildDialog.js";

export function HomePage() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4" style={{ backgroundColor: "var(--color-bg-main)" }}>
      <p style={{ color: "var(--color-text-muted)" }}>You are not in a server yet.</p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded px-4 py-2 text-sm font-medium"
        style={{ backgroundColor: "var(--color-accent)", color: "white" }}
      >
        Create or join a server
      </button>
      <CreateOrJoinGuildDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
