// Channel settings: rename, edit the topic, move up/down (the keyboard
// alternative to drag-and-drop reorder), and delete with confirmation.
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { channelNameSchema, type ChannelJson } from "@discord-clone/shared";
import { deleteChannel, updateChannel } from "@discord-clone/client-core";
import { session } from "../lib/session.js";
import { describeError } from "../lib/errors.js";
import { realtimeStore } from "../lib/realtime.js";

export function ChannelSettingsDialog({
  open,
  onClose,
  channel,
  onMove,
}: {
  open: boolean;
  onClose: () => void;
  channel: ChannelJson;
  /** Swap this channel with its sibling above/below, within its category. */
  onMove: (direction: "up" | "down") => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(channel.name ?? "");
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setName(channel.name ?? "");
      setTopic(channel.topic ?? "");
      setError(null);
      setConfirmingDelete(false);
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, channel.name, channel.topic]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (channel.type !== "category") {
      const parsed = channelNameSchema.safeParse(name);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "This name is not valid.");
        return;
      }
    }
    setPending(true);
    setError(null);
    try {
      const updated = await updateChannel(session.apiClient, channel.id, {
        name,
        topic: channel.type === "text" ? (topic.trim() === "" ? null : topic) : undefined,
      });
      realtimeStore.getState().applyDispatch({ t: "CHANNEL_UPDATE", d: updated });
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    setPending(true);
    setError(null);
    try {
      await deleteChannel(session.apiClient, channel.id);
      realtimeStore.getState().applyDispatch({
        t: "CHANNEL_DELETE",
        d: { id: channel.id, guildId: channel.guildId },
      });
      onClose();
      navigate(`/app/${channel.guildId}`);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="w-full max-w-sm rounded-lg border p-6"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-sidebar)", color: "var(--color-text-primary)" }}
      aria-label="Channel settings"
    >
      <h2 className="mb-4 text-lg font-semibold">Channel settings</h2>

      <form onSubmit={handleSave}>
        <label htmlFor="channel-settings-name" className="mb-1 block text-sm font-medium">
          Name
        </label>
        <input
          id="channel-settings-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-4 w-full rounded border px-3 py-2 text-sm"
          style={{ backgroundColor: "var(--color-bg-main)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
        />

        {channel.type === "text" && (
          <>
            <label htmlFor="channel-settings-topic" className="mb-1 block text-sm font-medium">
              Topic
            </label>
            <input
              id="channel-settings-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="mb-4 w-full rounded border px-3 py-2 text-sm"
              style={{ backgroundColor: "var(--color-bg-main)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
            />
          </>
        )}

        <div className="mb-4 flex gap-2">
          <button type="button" onClick={() => onMove("up")} className="rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--color-border)" }}>
            Move up
          </button>
          <button type="button" onClick={() => onMove("down")} className="rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--color-border)" }}>
            Move down
          </button>
        </div>

        {error && (
          <p role="alert" className="mb-4 text-sm" style={{ color: "#e05252" }}>
            {error}
          </p>
        )}

        <div className="flex justify-between gap-2">
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="rounded px-3 py-2 text-sm"
            style={{ color: "#e05252" }}
          >
            Delete channel
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded px-3 py-2 text-sm">
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded px-3 py-2 text-sm font-medium"
              style={{ backgroundColor: "var(--color-accent)", color: "white" }}
            >
              {pending ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </form>

      {confirmingDelete && (
        <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--color-border)" }}>
          <p className="mb-3 text-sm">Delete #{channel.name}? This cannot be undone.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmingDelete(false)} className="rounded px-3 py-2 text-sm">
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={handleDelete}
              className="rounded px-3 py-2 text-sm font-medium"
              style={{ backgroundColor: "#e05252", color: "white" }}
            >
              {pending ? "Deleting..." : "Delete channel"}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
