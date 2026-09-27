// Server settings: rename, change or remove the icon, and (owner only)
// delete the server with a typed-name confirmation.
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { guildNameSchema, type GuildJson } from "@discord-clone/shared";
import { deleteGuild, removeGuildIcon, updateGuild, uploadGuildIcon } from "@discord-clone/client-core";
import { session } from "../lib/session.js";
import { describeError } from "../lib/errors.js";
import { realtimeStore } from "../lib/realtime.js";

const MAX_ICON_BYTES = 1024 * 1024;
const ALLOWED_ICON_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function GuildSettingsDialog({
  open,
  onClose,
  guild,
  isOwner,
}: {
  open: boolean;
  onClose: () => void;
  guild: GuildJson;
  isOwner: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(guild.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDeleteText, setConfirmDeleteText] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setName(guild.name);
      setError(null);
      setConfirmingDelete(false);
      setConfirmDeleteText("");
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, guild.name]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    const parsed = guildNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "This name is not valid.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const updated = await updateGuild(session.apiClient, guild.id, { name: parsed.data });
      realtimeStore.getState().applyDispatch({ t: "GUILD_UPDATE", d: updated });
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending(false);
    }
  }

  async function handleIconChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!ALLOWED_ICON_TYPES.has(file.type)) {
      setError("The icon must be a PNG, JPEG or WEBP image.");
      return;
    }
    if (file.size > MAX_ICON_BYTES) {
      setError("The icon must be at most 1 MB.");
      return;
    }
    try {
      const updated = await uploadGuildIcon(session.apiClient, guild.id, file);
      realtimeStore.getState().applyDispatch({ t: "GUILD_UPDATE", d: updated });
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleRemoveIcon() {
    try {
      const updated = await removeGuildIcon(session.apiClient, guild.id);
      realtimeStore.getState().applyDispatch({ t: "GUILD_UPDATE", d: updated });
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleDelete() {
    if (confirmDeleteText !== guild.name) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await deleteGuild(session.apiClient, guild.id);
      onClose();
      navigate("/app");
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
      aria-label="Server settings"
    >
      <h2 className="mb-4 text-lg font-semibold">Server settings</h2>

      <div className="mb-4 flex items-center gap-3">
        {guild.iconKey ? (
          <img src={`/api/v1/icons/${guild.id}/${guild.iconKey}`} alt="" className="h-14 w-14 rounded-full object-cover" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: "var(--color-bg-main)" }} />
        )}
        <div className="flex flex-col gap-1">
          <label className="cursor-pointer text-sm underline">
            Change icon
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={handleIconChange} />
          </label>
          {guild.iconKey && (
            <button type="button" onClick={handleRemoveIcon} className="text-left text-sm underline">
              Remove icon
            </button>
          )}
        </div>
      </div>

      <form onSubmit={handleSave}>
        <label htmlFor="guild-settings-name" className="mb-1 block text-sm font-medium">
          Server name
        </label>
        <input
          id="guild-settings-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-4 w-full rounded border px-3 py-2 text-sm"
          style={{ backgroundColor: "var(--color-bg-main)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
        />
        {error && (
          <p role="alert" className="mb-4 text-sm" style={{ color: "#e05252" }}>
            {error}
          </p>
        )}
        <div className="flex justify-between gap-2">
          {isOwner && (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="rounded px-3 py-2 text-sm"
              style={{ color: "#e05252" }}
            >
              Delete server
            </button>
          )}
          <div className="ml-auto flex gap-2">
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
          <p className="mb-2 text-sm">
            Deleting this server cannot be undone. Type <strong>{guild.name}</strong> to confirm.
          </p>
          <input
            aria-label={`Type ${guild.name} to confirm deletion`}
            value={confirmDeleteText}
            onChange={(e) => setConfirmDeleteText(e.target.value)}
            className="mb-3 w-full rounded border px-3 py-2 text-sm"
            style={{ backgroundColor: "var(--color-bg-main)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmingDelete(false)} className="rounded px-3 py-2 text-sm">
              Cancel
            </button>
            <button
              type="button"
              disabled={pending || confirmDeleteText !== guild.name}
              onClick={handleDelete}
              className="rounded px-3 py-2 text-sm font-medium"
              style={{ backgroundColor: "#e05252", color: "white" }}
            >
              {pending ? "Deleting..." : "Delete server"}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
