// The push-to-talk state machine: pure logic, no DOM access. It turns key
// events into one "active" flag (the mic should be open). The caller wires
// real key events, window blur and page visibility to its methods; see
// `voice.ts` for that wiring. Kept pure so a test can drive it with fake
// timers, per CLAUDE.md's test rules.

/** The mic stays open this long after key release, so short gaps between words do not cut speech. */
export const PTT_RELEASE_DELAY_MS = 200;

export interface PushToTalkDeps {
  /** Starts a timer and returns an id `clear` can cancel. Defaults to `setTimeout`/`clearTimeout`. */
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
}

const defaultDeps: PushToTalkDeps = {
  setTimeout: (cb, ms) => setTimeout(cb, ms) as unknown as number,
  clearTimeout: (id) => clearTimeout(id),
};

/**
 * Tracks whether the push-to-talk key is held and reports one "active"
 * flag through `onActiveChange`. Release is delayed by
 * `PTT_RELEASE_DELAY_MS` so the mic does not chop the end of a word.
 */
export class PushToTalkController {
  private readonly deps: PushToTalkDeps;
  private readonly onActiveChange: (active: boolean) => void;
  private held = false;
  private active = false;
  private releaseTimer: number | null = null;

  constructor(onActiveChange: (active: boolean) => void, deps: PushToTalkDeps = defaultDeps) {
    this.onActiveChange = onActiveChange;
    this.deps = deps;
  }

  isActive(): boolean {
    return this.active;
  }

  /** Call when the push-to-talk key goes down. Ignores key-repeat (already held). */
  keyDown(): void {
    if (this.held) {
      return;
    }
    this.held = true;
    this.clearReleaseTimer();
    this.setActive(true);
  }

  /** Call when the push-to-talk key comes up. The mic stays open briefly. */
  keyUp(): void {
    if (!this.held) {
      return;
    }
    this.held = false;
    this.scheduleRelease();
  }

  /** Call on window blur or page hide: releases at once, no delay, since the key state can no longer be tracked. */
  releaseNow(): void {
    this.held = false;
    this.clearReleaseTimer();
    this.setActive(false);
  }

  /** Stops any pending timer. Call when the controller is torn down (dialog closed, call ended, mode switched). */
  dispose(): void {
    this.clearReleaseTimer();
  }

  private scheduleRelease(): void {
    this.clearReleaseTimer();
    this.releaseTimer = this.deps.setTimeout(() => {
      this.releaseTimer = null;
      if (!this.held) {
        this.setActive(false);
      }
    }, PTT_RELEASE_DELAY_MS);
  }

  private clearReleaseTimer(): void {
    if (this.releaseTimer !== null) {
      this.deps.clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
  }

  private setActive(next: boolean): void {
    if (this.active === next) {
      return;
    }
    this.active = next;
    this.onActiveChange(next);
  }
}

/**
 * True when a keyboard event during text entry should still reach
 * push-to-talk (a non-printable key, such as a function key, cannot be
 * typed into the field, so it is safe to treat as the PTT key). False
 * means: the user is typing, let the field have the key.
 */
export function isPttKeyAllowedWhileTyping(eventKey: string): boolean {
  return eventKey.length !== 1;
}

/** True when the event target is a text field where typing should not trigger push-to-talk. Duck-typed, so a plain-object test double works without a DOM. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") {
    return false;
  }
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  if (typeof el.tagName !== "string") {
    return false;
  }
  const tag = el.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable === true;
}

/** The modifier names of a global shortcut, in the order that `shortcutFromEvent` writes them. */
const SHORTCUT_MODIFIERS = ["Control", "Alt", "Shift", "Super"] as const;

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
]);

/** The parts of a keyboard event that a shortcut uses. A plain object works in a test. */
export interface ShortcutKeyEvent {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * A global shortcut for the desktop app, such as "Control+Shift+KeyT", from
 * a key press. Returns null for a modifier key alone: the capture waits for
 * the main key.
 */
export function shortcutFromEvent(event: ShortcutKeyEvent): string | null {
  if (MODIFIER_CODES.has(event.code) || event.code === "") {
    return null;
  }
  const held = [event.ctrlKey, event.altKey, event.shiftKey, event.metaKey];
  const parts: string[] = SHORTCUT_MODIFIERS.filter((_name, index) => held[index]);
  parts.push(event.code);
  return parts.join("+");
}

/** The main key code of a shortcut: "KeyT" for "Control+Shift+KeyT", and "Backquote" for "Backquote". */
export function shortcutKeyCode(shortcut: string): string {
  return shortcut.split("+").at(-1) ?? shortcut;
}

/** A short, readable name for a `KeyboardEvent.code` value, or for a shortcut with modifiers, for the settings dialog and the status panel. */
export function describeKeyCode(code: string): string {
  if (code.includes("+")) {
    const parts = code.split("+");
    const key = parts.pop() ?? "";
    const names: Record<string, string> = { Control: "Ctrl", Alt: "Alt", Shift: "Shift", Super: "Win/Cmd" };
    return [...parts.map((part) => names[part] ?? part), describeKeyCode(key)].join(" + ");
  }
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const named: Record<string, string> = {
    Space: "Space",
    ControlLeft: "Left Ctrl",
    ControlRight: "Right Ctrl",
    ShiftLeft: "Left Shift",
    ShiftRight: "Right Shift",
    AltLeft: "Left Alt",
    AltRight: "Right Alt",
    CapsLock: "Caps Lock",
  };
  return named[code] ?? code;
}
