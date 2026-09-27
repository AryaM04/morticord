// The message composer: an autosize textarea, plus the reply/edit banner
// above it. Enter sends. Shift+Enter starts a new line. Escape cancels a
// reply or an edit. ArrowUp in an empty box edits the sender's last
// message.
import { useEffect, useRef, useState } from "react";
import { messagesStore } from "../lib/messages.js";

const MAX_BODY_LENGTH = 4000;
const COUNTER_THRESHOLD = MAX_BODY_LENGTH - 200;
const MENTION_RE = /<@(\d+)>/g;

export function extractMentions(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(MENTION_RE)) {
    ids.add(match[1]!);
  }
  return [...ids];
}

export interface ReplyTarget {
  id: string;
  authorName: string;
  preview: string;
}

export interface EditTarget {
  id: string;
  body: string;
}

export interface ComposerProps {
  channelId: string;
  canSend: boolean;
  disabledReason?: string;
  replyTarget: ReplyTarget | null;
  onCancelReply: () => void;
  editTarget: EditTarget | null;
  onCancelEdit: () => void;
  onRequestEditLast: () => void;
}

export function Composer(props: ComposerProps) {
  const { channelId, editTarget } = props;
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editTarget) {
      setText(editTarget.body);
      textareaRef.current?.focus();
    }
  }, [editTarget]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  function submit(): void {
    const body = text.trim();
    if (body.length === 0 || body.length > MAX_BODY_LENGTH) {
      return;
    }
    const mentions = extractMentions(body);
    if (editTarget) {
      void messagesStore.getState().editMessage(channelId, editTarget.id, body, mentions);
      props.onCancelEdit();
    } else {
      void messagesStore.getState().sendMessage(channelId, body, mentions, props.replyTarget?.id);
      props.onCancelReply();
    }
    setText("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === "Escape") {
      if (props.editTarget) {
        props.onCancelEdit();
        setText("");
      } else if (props.replyTarget) {
        props.onCancelReply();
      }
      return;
    }
    if (event.key === "ArrowUp" && text.length === 0 && !props.editTarget) {
      props.onRequestEditLast();
    }
  }

  const remaining = MAX_BODY_LENGTH - text.length;

  return (
    <div className="px-4 pb-4">
      {(props.replyTarget || props.editTarget) && (
        <div
          className="mb-1 flex items-center justify-between rounded-t px-3 py-1 text-xs"
          style={{ backgroundColor: "var(--color-bg-sidebar)", color: "var(--color-text-muted)" }}
        >
          <span>
            {props.editTarget ? "Editing a message." : `Reply to ${props.replyTarget!.authorName}.`}
          </span>
          <button
            type="button"
            onClick={() => {
              if (props.editTarget) {
                props.onCancelEdit();
                setText("");
              } else {
                props.onCancelReply();
              }
            }}
            aria-label="Cancel"
          >
            ×
          </button>
        </div>
      )}
      <div
        className="flex items-end gap-2 rounded px-3 py-2"
        style={{ backgroundColor: "var(--color-bg-sidebar)" }}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          disabled={!props.canSend}
          placeholder={props.canSend ? "Write a message." : props.disabledReason ?? "You cannot send a message here."}
          onChange={(event) => {
            setText(event.target.value);
            if (event.target.value.length > 0) {
              messagesStore.getState().notifyTyping(channelId);
            }
          }}
          onKeyDown={handleKeyDown}
          className="max-h-60 flex-1 resize-none bg-transparent py-1 text-sm outline-none"
          style={{ color: "var(--color-text-primary)" }}
        />
        {remaining <= COUNTER_THRESHOLD && (
          <span
            className="pb-1 text-xs"
            style={{ color: remaining < 0 ? "#e05252" : "var(--color-text-muted)" }}
          >
            {remaining}
          </span>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!props.canSend || text.trim().length === 0 || text.length > MAX_BODY_LENGTH}
          className="rounded px-3 py-1 text-sm font-medium"
          style={{ backgroundColor: "var(--color-accent)", color: "white" }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
