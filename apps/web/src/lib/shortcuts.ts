// The keyboard shortcuts of the app. This file holds only pure functions, so
// a test can run them without a DOM. `ShortcutHandler.tsx` runs the actions.
import { isTypingTarget } from "./ptt.js";

export type ShortcutId =
  | "quick-switcher"
  | "previous-channel"
  | "next-channel"
  | "previous-unread"
  | "next-unread"
  | "toggle-mute"
  | "toggle-deafen"
  | "mark-read"
  | "show-help";

export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** The shortcuts that also work while the focus is in a text field. */
const WORKS_WHILE_TYPING: ReadonlySet<ShortcutId> = new Set(["quick-switcher", "mark-read"]);

/** Find the shortcut of a key press. "Mod" is Cmd on a Mac, and Ctrl on the other systems. */
export function matchShortcut(event: KeyInput, mac: boolean): ShortcutId | null {
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  if (key === "Escape" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    return "mark-read";
  }
  if (mod && !event.altKey) {
    if (!event.shiftKey && key === "k") return "quick-switcher";
    if (!event.shiftKey && key === "/") return "show-help";
    if (event.shiftKey && key === "m") return "toggle-mute";
    if (event.shiftKey && key === "d") return "toggle-deafen";
    return null;
  }
  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    if (key === "ArrowUp") return event.shiftKey ? "previous-unread" : "previous-channel";
    if (key === "ArrowDown") return event.shiftKey ? "next-unread" : "next-channel";
  }
  return null;
}

/** True when the shortcut must fire for this event target. */
export function shouldRunShortcut(id: ShortcutId, target: EventTarget | null): boolean {
  return WORKS_WHILE_TYPING.has(id) || !isTypingTarget(target);
}

/**
 * The id next to `currentId` in `ids`, in the direction `step`. The list wraps
 * at its ends. When `accept` is set, only an id that it accepts counts. The
 * result is null when no id fits. When `currentId` is not in the list, the
 * search starts at the first id (step 1) or at the last id (step -1).
 */
export function adjacentId(
  ids: readonly string[],
  currentId: string | null,
  step: 1 | -1,
  accept: (id: string) => boolean = () => true,
): string | null {
  const count = ids.length;
  const start = currentId === null ? -1 : ids.indexOf(currentId);
  for (let offset = 1; offset <= count; offset += 1) {
    const index =
      start === -1 ? (step === 1 ? offset - 1 : count - offset) : (((start + step * offset) % count) + count) % count;
    const id = ids[index]!;
    if (id !== currentId && accept(id)) return id;
  }
  return null;
}

/** The text channels of a server in the order of the channel list: top level first, then each category. */
export function orderedTextChannelIds(
  channelIds: readonly string[],
  channels: Readonly<Record<string, { type: string; parentId: string | null } | undefined>>,
): string[] {
  const textIn = (parentId: string | null) =>
    channelIds.filter((id) => channels[id]?.type === "text" && channels[id]?.parentId === parentId);
  const categories = channelIds.filter((id) => channels[id]?.type === "category");
  return [...textIn(null), ...categories.flatMap((id) => textIn(id))];
}

/** One row of the help dialog. */
export const SHORTCUT_HELP: ReadonlyArray<{ id: ShortcutId; keys: string; description: string }> = [
  { id: "quick-switcher", keys: "Mod+K", description: "Open the quick switcher." },
  { id: "previous-channel", keys: "Alt+Up", description: "Go to the previous channel." },
  { id: "next-channel", keys: "Alt+Down", description: "Go to the next channel." },
  { id: "previous-unread", keys: "Alt+Shift+Up", description: "Go to the previous unread channel." },
  { id: "next-unread", keys: "Alt+Shift+Down", description: "Go to the next unread channel." },
  { id: "toggle-mute", keys: "Mod+Shift+M", description: "Mute or unmute the microphone in a call." },
  { id: "toggle-deafen", keys: "Mod+Shift+D", description: "Deafen or undeafen in a call." },
  { id: "mark-read", keys: "Escape", description: "Mark the channel as read." },
  { id: "show-help", keys: "Mod+/", description: "Show this list." },
];

/** The key text of a help row. "Mod" is Cmd on a Mac, and Ctrl on the other systems. */
export function keysLabel(keys: string, mac: boolean): string {
  return keys.replace("Mod", mac ? "Cmd" : "Ctrl");
}

/** True on an Apple system, where the shortcuts use Cmd instead of Ctrl. */
export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
}
