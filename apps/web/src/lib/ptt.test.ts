import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  PTT_RELEASE_DELAY_MS,
  PushToTalkController,
  describeKeyCode,
  isPttKeyAllowedWhileTyping,
  isTypingTarget,
  shortcutFromEvent,
  shortcutKeyCode,
} from "./ptt.js";

describe("PushToTalkController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("goes active on key down and reports it once", () => {
    const onActiveChange = vi.fn();
    const controller = new PushToTalkController(onActiveChange);
    controller.keyDown();
    expect(controller.isActive()).toBe(true);
    expect(onActiveChange).toHaveBeenCalledTimes(1);
    expect(onActiveChange).toHaveBeenCalledWith(true);
  });

  it("ignores key repeat while already held", () => {
    const onActiveChange = vi.fn();
    const controller = new PushToTalkController(onActiveChange);
    controller.keyDown();
    controller.keyDown();
    controller.keyDown();
    expect(onActiveChange).toHaveBeenCalledTimes(1);
  });

  it("stays active for the release delay after key up, then goes inactive", () => {
    const onActiveChange = vi.fn();
    const controller = new PushToTalkController(onActiveChange);
    controller.keyDown();
    controller.keyUp();
    expect(controller.isActive()).toBe(true);
    vi.advanceTimersByTime(PTT_RELEASE_DELAY_MS - 1);
    expect(controller.isActive()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(controller.isActive()).toBe(false);
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  it("cancels the release timer when the key is pressed again before it fires", () => {
    const onActiveChange = vi.fn();
    const controller = new PushToTalkController(onActiveChange);
    controller.keyDown();
    controller.keyUp();
    vi.advanceTimersByTime(PTT_RELEASE_DELAY_MS / 2);
    controller.keyDown();
    vi.advanceTimersByTime(PTT_RELEASE_DELAY_MS);
    expect(controller.isActive()).toBe(true);
    expect(onActiveChange).toHaveBeenCalledTimes(1);
  });

  it("releases at once on releaseNow, with no delay", () => {
    const onActiveChange = vi.fn();
    const controller = new PushToTalkController(onActiveChange);
    controller.keyDown();
    controller.releaseNow();
    expect(controller.isActive()).toBe(false);
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  it("keyUp without a prior keyDown does nothing", () => {
    const onActiveChange = vi.fn();
    const controller = new PushToTalkController(onActiveChange);
    controller.keyUp();
    expect(controller.isActive()).toBe(false);
    expect(onActiveChange).not.toHaveBeenCalled();
  });

  it("dispose stops a pending release timer from firing", () => {
    const onActiveChange = vi.fn();
    const controller = new PushToTalkController(onActiveChange);
    controller.keyDown();
    controller.keyUp();
    controller.dispose();
    vi.advanceTimersByTime(PTT_RELEASE_DELAY_MS + 10);
    // The active flag itself is not force-cleared by dispose, only the timer;
    // the caller is expected to also call releaseNow() when appropriate.
    expect(onActiveChange).not.toHaveBeenCalledWith(false);
  });
});

describe("isPttKeyAllowedWhileTyping", () => {
  it("allows non-printable keys, such as function keys", () => {
    expect(isPttKeyAllowedWhileTyping("F13")).toBe(true);
    expect(isPttKeyAllowedWhileTyping("Control")).toBe(true);
  });

  it("blocks single printable characters", () => {
    expect(isPttKeyAllowedWhileTyping("a")).toBe(false);
    expect(isPttKeyAllowedWhileTyping(" ")).toBe(false);
  });
});

describe("isTypingTarget", () => {
  it("is true for input and textarea elements", () => {
    expect(isTypingTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
  });

  it("is true for a content-editable element", () => {
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(true);
  });

  it("is false for a plain div", () => {
    expect(isTypingTarget({ tagName: "DIV" } as unknown as EventTarget)).toBe(false);
  });

  it("is false for null", () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("shortcutFromEvent", () => {
  const press = (code: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) => ({
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  });

  it("writes the modifiers in a fixed order before the key", () => {
    expect(shortcutFromEvent(press("KeyT", { shiftKey: true, ctrlKey: true }))).toBe("Control+Shift+KeyT");
    expect(shortcutFromEvent(press("F8", { metaKey: true, altKey: true }))).toBe("Alt+Super+F8");
  });

  it("gives a plain key without modifiers", () => {
    expect(shortcutFromEvent(press("Backquote"))).toBe("Backquote");
  });

  it("waits for the main key when only a modifier is down", () => {
    expect(shortcutFromEvent(press("ControlLeft", { ctrlKey: true }))).toBeNull();
    expect(shortcutFromEvent(press("MetaRight", { metaKey: true }))).toBeNull();
  });
});

describe("shortcutKeyCode and describeKeyCode", () => {
  it("finds the main key of a shortcut", () => {
    expect(shortcutKeyCode("Control+Shift+KeyT")).toBe("KeyT");
    expect(shortcutKeyCode("Backquote")).toBe("Backquote");
  });

  it("describes a shortcut with modifiers", () => {
    expect(describeKeyCode("Control+Shift+KeyT")).toBe("Ctrl + Shift + T");
    expect(describeKeyCode("Digit4")).toBe("4");
  });
});
