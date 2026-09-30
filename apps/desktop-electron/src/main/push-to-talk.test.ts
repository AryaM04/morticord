// Tests for the global push-to-talk key: the session check, the key code
// table (against the key list of uiohook-napi), the shortcut reader and
// the press and release logic with a fake key hook.
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  GlobalPushToTalk,
  keyCodeOf,
  parseShortcut,
  PUSH_TO_TALK_UNAVAILABLE,
  pushToTalkUnavailableReason,
  type KeyEvent,
  type KeyHook,
} from "./push-to-talk.js";

describe("pushToTalkUnavailableReason", () => {
  it("allows an X11 session and refuses a Wayland session", () => {
    expect(pushToTalkUnavailableReason("linux", { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" })).toBeNull();
    expect(pushToTalkUnavailableReason("linux", { XDG_SESSION_TYPE: "wayland", DISPLAY: ":0" })).toBe(
      PUSH_TO_TALK_UNAVAILABLE,
    );
    expect(pushToTalkUnavailableReason("linux", { WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" })).toBe(
      PUSH_TO_TALK_UNAVAILABLE,
    );
    expect(pushToTalkUnavailableReason("linux", {})).toBe(PUSH_TO_TALK_UNAVAILABLE);
    expect(pushToTalkUnavailableReason("win32", {})).toBeNull();
    expect(PUSH_TO_TALK_UNAVAILABLE).toBe("Global push to talk is not available on this desktop session.");
  });
});

/** The key codes that uiohook-napi declares, read from its type file (no native module load). */
function uiohookKeys(): Map<string, number> {
  const require = createRequire(import.meta.url);
  const packageDir = dirname(require.resolve("uiohook-napi/package.json"));
  const types = readFileSync(join(packageDir, "dist", "index.d.ts"), "utf8");
  const keys = new Map<string, number>();
  for (const match of types.matchAll(/readonly (\w+): (\d+);/g)) {
    keys.set(match[1]!, Number(match[2]));
  }
  return keys;
}

describe("keyCodeOf", () => {
  it("matches the key codes of uiohook-napi for each key", () => {
    const keys = uiohookKeys();
    expect(keys.size).toBeGreaterThan(90);
    for (const [name, code] of keys) {
      let eventCode: string | null = null;
      if (/^[A-Z]$/.test(name)) eventCode = `Key${name}`;
      else if (/^[0-9]$/.test(name)) eventCode = `Digit${name}`;
      else if (/^(Ctrl|Alt|Shift|Meta)(Right)?$/.test(name)) eventCode = null; // Modifiers are not push-to-talk keys.
      else eventCode = name;
      if (eventCode) {
        expect(keyCodeOf(eventCode), eventCode).toBe(code);
      }
    }
  });

  it("gives null for a key that it does not know", () => {
    expect(keyCodeOf("MediaPlayPause")).toBeNull();
    expect(keyCodeOf("F25")).toBeNull();
    expect(keyCodeOf("Keyt")).toBeNull();
  });
});

describe("parseShortcut", () => {
  it("reads the modifiers and the key", () => {
    expect(parseShortcut("Control+Shift+KeyT")).toEqual({
      keyCode: 20,
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
      metaKey: false,
    });
    expect(parseShortcut("F13").keyCode).toBe(91);
    expect(parseShortcut("Super+Backquote")).toMatchObject({ keyCode: 41, metaKey: true });
  });

  it("refuses an unknown modifier, a repeated modifier and an unknown key", () => {
    for (const shortcut of ["Hyper+KeyT", "Control+Control+KeyT", "Control+MediaPlayPause", ""]) {
      expect(() => parseShortcut(shortcut), shortcut).toThrow(/cannot use this key/);
    }
  });
});

class FakeHook extends EventEmitter implements KeyHook {
  started = 0;
  stopped = 0;
  failStart = false;
  start(): void {
    if (this.failStart) throw new Error("XRecord is not available");
    this.started += 1;
  }
  stop(): void {
    this.stopped += 1;
  }
  key(type: "keydown" | "keyup", keycode: number, modifiers: Partial<KeyEvent> = {}): void {
    this.emit(type, { keycode, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers });
  }
}

describe("GlobalPushToTalk", () => {
  it("sends one press and one release, with the modifiers held, and ignores key repeat", async () => {
    const hook = new FakeHook();
    const onChange = vi.fn();
    const ptt = new GlobalPushToTalk(async () => hook, onChange);
    await ptt.set("Control+KeyT");
    expect(hook.started).toBe(1);

    hook.key("keydown", 20); // No Control: not the shortcut.
    expect(onChange).not.toHaveBeenCalled();
    hook.key("keydown", 20, { ctrlKey: true });
    hook.key("keydown", 20, { ctrlKey: true }); // Key repeat.
    hook.key("keyup", 29); // Another key.
    hook.key("keyup", 20);
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it("stops the hook and releases a held key when the shortcut is removed", async () => {
    const hook = new FakeHook();
    const onChange = vi.fn();
    const ptt = new GlobalPushToTalk(async () => hook, onChange);
    await ptt.set("F9");
    hook.key("keydown", 67);
    await ptt.set(null);
    expect(hook.stopped).toBe(1);
    expect(hook.listenerCount("keydown")).toBe(0);
    expect(onChange.mock.calls).toEqual([[true], [false]]);
    hook.key("keydown", 67);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("gives the plain reason when the hook does not load or start", async () => {
    const failing = new GlobalPushToTalk(async () => {
      throw new Error("libXtst.so.6: cannot open shared object file");
    }, vi.fn());
    await expect(failing.set("F9")).rejects.toThrow(PUSH_TO_TALK_UNAVAILABLE);

    const hook = new FakeHook();
    hook.failStart = true;
    await expect(new GlobalPushToTalk(async () => hook, vi.fn()).set("F9")).rejects.toThrow(PUSH_TO_TALK_UNAVAILABLE);
    expect(hook.listenerCount("keydown")).toBe(0);
  });
});
