// One message row: avatar and name (only on the first message of a
// group), the body, a reply preview line, the reactions row and the
// hover actions (react, reply, edit, delete).
import { useEffect, useRef, useState } from "react";
import type { AggregatedMessage } from "@discord-clone/client-core";
import { Markdown, MarkdownInline } from "./Markdown.js";
import { Avatar } from "./Avatar.js";
import type { User } from "@discord-clone/shared";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉"];

function DeleteConfirmDialog({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onCancel} className="rounded p-4" style={{ backgroundColor: "var(--color-bg-main)", color: "var(--color-text-primary)" }}>
      <p className="mb-3 text-sm">Do you want to delete this message? You cannot undo this.</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded px-3 py-1 text-sm">
          Cancel
        </button>
        <button type="button" onClick={onConfirm} className="rounded px-3 py-1 text-sm" style={{ backgroundColor: "#e05252", color: "white" }}>
          Delete
        </button>
      </div>
    </dialog>
  );
}

export interface MessageItemProps {
  message: AggregatedMessage;
  showHeader: boolean;
  author: User | undefined;
  authorName: string;
  isOwn: boolean;
  canManageMessages: boolean;
  selfUserId: string | null;
  isHighlighted: boolean;
  replyPreview: { authorName: string; text: string } | null;
  getDisplayName: (userId: string) => string | undefined;
  getReactorNames: (userIds: string[]) => string;
  onReplyClick: () => void;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleReaction: (key: string) => void;
  onAddReaction: (key: string) => void;
}

export function MessageItem(props: MessageItemProps) {
  const { message } = props;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const time = new Date(message.createdAt);
  const timeLabel = time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const fullDate = time.toLocaleString();

  function handleDeleteClick(event: React.MouseEvent): void {
    if (event.shiftKey) {
      props.onDelete();
    } else {
      setConfirmOpen(true);
    }
  }

  return (
    <div
      className="group flex gap-3 px-4 py-1 hover:bg-black/10"
      style={{ backgroundColor: props.isHighlighted ? "rgba(91, 108, 255, 0.15)" : undefined }}
      data-message-id={message.id}
    >
      <div className="w-10 shrink-0">
        {props.showHeader && props.author && <Avatar user={props.author} size={40} />}
      </div>
      <div className="min-w-0 flex-1">
        {props.replyPreview && (
          <button
            type="button"
            onClick={props.onReplyClick}
            className="mb-0.5 flex max-w-full items-center gap-1 truncate text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            <span>↪</span>
            <span className="font-medium">{props.replyPreview.authorName}</span>
            <span className="truncate">{props.replyPreview.text}</span>
          </button>
        )}
        {props.showHeader && (
          <div className="flex items-baseline gap-2">
            <span className="font-semibold">{props.authorName}</span>
            <span className="text-xs" title={fullDate} style={{ color: "var(--color-text-muted)" }}>
              {timeLabel}
            </span>
          </div>
        )}
        <div
          className="text-sm"
          style={{
            color: message.deleted || message.cannotRead ? "var(--color-text-muted)" : "var(--color-text-primary)",
            fontStyle: message.deleted || message.cannotRead ? "italic" : "normal",
          }}
        >
          {message.deleted || message.cannotRead ? (
            message.body
          ) : (
            <Markdown text={message.body} getDisplayName={props.getDisplayName} selfUserId={props.selfUserId} />
          )}
          {message.edited && !message.deleted && (
            <span className="ml-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
              (edited)
            </span>
          )}
        </div>

        {message.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {message.reactions.map((reaction) => (
              <button
                key={reaction.key}
                type="button"
                title={props.getReactorNames(reaction.userIds)}
                onClick={() => props.onToggleReaction(reaction.key)}
                className="rounded border px-1.5 py-0.5 text-xs"
                style={{
                  borderColor: reaction.ownEventId ? "var(--color-accent)" : "var(--color-border)",
                  backgroundColor: reaction.ownEventId ? "rgba(91, 108, 255, 0.15)" : "transparent",
                }}
              >
                {reaction.key} {reaction.userIds.length}
              </button>
            ))}
          </div>
        )}
      </div>

      {!message.deleted && !message.cannotRead && (
        <div className="relative hidden shrink-0 items-start gap-1 group-hover:flex">
          <div className="relative">
            <button
              type="button"
              aria-label="React"
              onClick={() => setPickerOpen((o) => !o)}
              className="rounded px-1.5 py-0.5 text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              🙂
            </button>
            {pickerOpen && (
              <div
                className="absolute right-0 top-full z-10 flex gap-1 rounded border p-1"
                style={{ backgroundColor: "var(--color-bg-main)", borderColor: "var(--color-border)" }}
              >
                {QUICK_REACTIONS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      props.onAddReaction(key);
                      setPickerOpen(false);
                    }}
                    className="px-1 text-sm"
                  >
                    {key}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" aria-label="Reply" onClick={props.onReply} className="rounded px-1.5 py-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            ↩
          </button>
          {props.isOwn && (
            <button type="button" aria-label="Edit" onClick={props.onEdit} className="rounded px-1.5 py-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
              ✎
            </button>
          )}
          {(props.isOwn || props.canManageMessages) && (
            <button type="button" aria-label="Delete" onClick={handleDeleteClick} className="rounded px-1.5 py-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
              🗑
            </button>
          )}
        </div>
      )}

      <DeleteConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          props.onDelete();
        }}
      />
    </div>
  );
}

export function DayDivider({ label }: { label: string }) {
  return (
    <div className="my-2 flex items-center gap-2 px-4 text-xs" style={{ color: "var(--color-text-muted)" }}>
      <div className="h-px flex-1" style={{ backgroundColor: "var(--color-border)" }} />
      {label}
      <div className="h-px flex-1" style={{ backgroundColor: "var(--color-border)" }} />
    </div>
  );
}

export function NewDivider() {
  return (
    <div className="my-1 flex items-center gap-2 px-4 text-xs font-semibold" style={{ color: "#e05252" }}>
      <div className="h-px flex-1" style={{ backgroundColor: "#e05252" }} />
      New
    </div>
  );
}

/** A pending (optimistic) or failed send, shown dimmed with retry/discard actions. */
export function PendingMessageRow({
  body,
  failed,
  onRetry,
  onDiscard,
}: {
  body: string;
  failed: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex gap-3 px-4 py-1" style={{ opacity: 0.6 }}>
      <div className="w-10 shrink-0" />
      <div className="min-w-0 flex-1 text-sm">
        <MarkdownInline text={body} />
        {failed && (
          <span className="ml-2 text-xs" style={{ color: "#e05252" }}>
            Not sent.{" "}
            <button type="button" onClick={onRetry} className="underline">
              Try again
            </button>{" "}
            /{" "}
            <button type="button" onClick={onDiscard} className="underline">
              Delete
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
