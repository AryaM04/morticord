// The message composer: an autosize textarea, plus the reply/edit banner
// above it and the @-mention suggestion listbox. Enter sends. Shift+Enter
// starts a new line. Escape cancels a reply, an edit, or the mention
// listbox. ArrowUp in an empty box edits the sender's last message.
import { useEffect, useId, useRef, useState } from "react";
import type { GuildMemberJson } from "@discord-clone/shared";
import { searchGuildMembers } from "@discord-clone/client-core";
import { messagesStore } from "../lib/messages.js";
import { session } from "../lib/session.js";
import { Avatar } from "./Avatar.js";
import { EmojiPickerButton } from "./EmojiPickerButton.js";

const MAX_BODY_LENGTH = 4000;
const COUNTER_THRESHOLD = MAX_BODY_LENGTH - 200;
const MENTION_RE = /<@(\d+)>/g;
const MAX_MENTIONS = 50;
const MENTION_SEARCH_DEBOUNCE_MS = 150;
const MENTION_SEARCH_LIMIT = 10;

/** Extract every `<@id>` token from a message body, in order, with no duplicate and at most 50. */
export function extractMentions(text: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(MENTION_RE)) {
    const id = match[1]!;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_MENTIONS) break;
  }
  return ids;
}

export interface MentionQuery {
  /** The index of the "@" that starts the query, inside the full text. */
  start: number;
  /** The name text typed after the "@", up to the caret. */
  query: string;
}

/**
 * Find an open `@` mention query ending at the caret, or null when there
 * is none. A query starts at the beginning of the text or after
 * whitespace, and its text has no whitespace and no second "@".
 */
export function detectMentionQueryAt(text: string, caret: number): MentionQuery | null {
  if (caret < 0 || caret > text.length) {
    return null;
  }
  const upToCaret = text.slice(0, caret);
  const atIndex = upToCaret.lastIndexOf("@");
  if (atIndex === -1) {
    return null;
  }
  const before = atIndex === 0 ? "" : upToCaret[atIndex - 1]!;
  if (before !== "" && !/\s/.test(before)) {
    return null;
  }
  const query = upToCaret.slice(atIndex + 1);
  if (query.length > 32 || /\s/.test(query) || query.includes("@")) {
    return null;
  }
  return { start: atIndex, query };
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
  guildId: string;
  canSend: boolean;
  disabledReason?: string;
  replyTarget: ReplyTarget | null;
  onCancelReply: () => void;
  editTarget: EditTarget | null;
  onCancelEdit: () => void;
  onRequestEditLast: () => void;
}

function memberLabel(member: GuildMemberJson): string {
  return member.nickname ?? member.user?.displayName ?? member.userId;
}

export function Composer(props: ComposerProps) {
  const { channelId, guildId, editTarget } = props;
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listboxId = useId();

  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const [suggestions, setSuggestions] = useState<GuildMemberJson[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchGenerationRef = useRef(0);

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

  // Close the mention listbox and cancel any pending search when the
  // channel changes, so a stale query from another channel never shows.
  useEffect(() => {
    closeMentionMenu();
  }, [channelId]);

  function closeMentionMenu(): void {
    setMentionQuery(null);
    setSuggestions([]);
    setActiveIndex(0);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }

  function scheduleMentionSearch(query: string): void {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (query.length === 0) {
      setSuggestions([]);
      return;
    }
    const generation = ++searchGenerationRef.current;
    debounceRef.current = setTimeout(() => {
      void searchGuildMembers(session.apiClient, guildId, query, MENTION_SEARCH_LIMIT)
        .then((result) => {
          if (searchGenerationRef.current === generation) {
            setSuggestions(result.members);
            setActiveIndex(0);
          }
        })
        .catch(() => {
          if (searchGenerationRef.current === generation) {
            setSuggestions([]);
          }
        });
    }, MENTION_SEARCH_DEBOUNCE_MS);
  }

  /** Recompute the mention query from the textarea's current text and caret. */
  function syncMentionQuery(el: HTMLTextAreaElement, value: string): void {
    const caret = el.selectionStart ?? value.length;
    const query = detectMentionQueryAt(value, caret);
    setMentionQuery(query);
    if (query) {
      scheduleMentionSearch(query.query);
    } else {
      closeMentionMenu();
    }
  }

  function pickMention(member: GuildMemberJson): void {
    if (!mentionQuery) return;
    const before = text.slice(0, mentionQuery.start);
    const afterQueryIndex = mentionQuery.start + 1 + mentionQuery.query.length;
    const after = text.slice(afterQueryIndex);
    const inserted = `<@${member.userId}> `;
    const nextText = `${before}${inserted}${after}`;
    setText(nextText);
    closeMentionMenu();
    const caret = before.length + inserted.length;
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(caret, caret);
      }
    });
  }

  /** Insert `emoji` at the caret (or at the end of any selection), and put the caret after it. */
  function insertEmoji(emoji: string): void {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const nextText = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
    setText(nextText);
    const caret = start + emoji.length;
    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(caret, caret);
      }
    });
  }

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
    closeMentionMenu();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (mentionQuery && suggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pickMention(suggestions[activeIndex]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeMentionMenu();
        return;
      }
    }
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
  const mentionOpen = mentionQuery !== null && suggestions.length > 0;
  const activeOptionId = mentionOpen ? `${listboxId}-option-${activeIndex}` : undefined;

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
      {mentionOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Members"
          className="mb-1 max-h-56 overflow-y-auto rounded border py-1 shadow-lg"
          style={{ backgroundColor: "var(--color-bg-main)", borderColor: "var(--color-border)" }}
        >
          {suggestions.map((member, index) => (
            <div
              key={member.userId}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => {
                event.preventDefault();
                pickMention(member);
              }}
              className="flex items-center gap-2 px-3 py-1 text-sm"
              style={{ backgroundColor: index === activeIndex ? "var(--color-bg-sidebar)" : "transparent" }}
            >
              {member.user && <Avatar user={member.user} size={20} />}
              <span>{memberLabel(member)}</span>
              {member.user && (
                <span style={{ color: "var(--color-text-muted)" }}>@{member.user.username}</span>
              )}
            </div>
          ))}
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
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={mentionOpen}
          aria-controls={mentionOpen ? listboxId : undefined}
          aria-activedescendant={activeOptionId}
          onChange={(event) => {
            const value = event.target.value;
            setText(value);
            if (value.length > 0) {
              messagesStore.getState().notifyTyping(channelId);
            }
            syncMentionQuery(event.target, value);
          }}
          onSelect={(event) => syncMentionQuery(event.currentTarget, event.currentTarget.value)}
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
        {props.canSend && (
          <EmojiPickerButton
            ariaLabel="Open the emoji picker"
            label="🙂"
            onPick={insertEmoji}
            className="rounded px-1.5 py-1 text-base"
            style={{ color: "var(--color-text-muted)" }}
          />
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
