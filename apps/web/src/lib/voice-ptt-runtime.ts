// Wires the pure `PushToTalkController` to real key events. In a browser,
// these are key down/up on `window`, plus the two ways a page loses the
// ability to see further key events (losing focus, or being hidden). So
// push to talk works only while this window has focus. The desktop app
// registers the key as a global shortcut instead, which works while the
// window has no focus (see `platform.ts`).
import { isPttKeyAllowedWhileTyping, isTypingTarget, PushToTalkController, shortcutKeyCode } from "./ptt.js";
import { desktopFeatures } from "./platform.js";
import { voiceDeviceSettingsStore } from "./voice-settings.js";

let controller: PushToTalkController | null = null;
let keyDownHandler: ((event: KeyboardEvent) => void) | null = null;
let keyUpHandler: ((event: KeyboardEvent) => void) | null = null;
let blurHandler: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;
let removeGlobalShortcut: (() => void) | null = null;
/** Counts the starts, so a late global shortcut result of an old start is removed at once. */
let startCount = 0;

function addWindowListeners(active: PushToTalkController): void {
  // The key code of the setting. A desktop shortcut such as "Control+KeyT" gives "KeyT" here.
  const pttKeyCode = () => {
    const shortcut = voiceDeviceSettingsStore.getState().pttKeyCode;
    return shortcut ? shortcutKeyCode(shortcut) : null;
  };
  keyDownHandler = (event: KeyboardEvent) => {
    const code = pttKeyCode();
    if (!code || event.code !== code) {
      return;
    }
    if (isTypingTarget(event.target) && !isPttKeyAllowedWhileTyping(event.key)) {
      return;
    }
    event.preventDefault();
    active.keyDown();
  };
  keyUpHandler = (event: KeyboardEvent) => {
    const code = pttKeyCode();
    if (!code || event.code !== code) {
      return;
    }
    active.keyUp();
  };
  blurHandler = () => active.releaseNow();
  visibilityHandler = () => {
    if (document.visibilityState === "hidden") {
      active.releaseNow();
    }
  };

  window.addEventListener("keydown", keyDownHandler);
  window.addEventListener("keyup", keyUpHandler);
  window.addEventListener("blur", blurHandler);
  document.addEventListener("visibilitychange", visibilityHandler);
}

/** Starts listening for the push-to-talk key. Call once per call; call `stopPushToTalkRuntime` before calling again. */
export function startPushToTalkRuntime(onActiveChange: (active: boolean) => void): void {
  stopPushToTalkRuntime();
  const active = new PushToTalkController(onActiveChange);
  controller = active;

  const desktop = desktopFeatures();
  const shortcut = voiceDeviceSettingsStore.getState().pttKeyCode;
  if (!desktop || !shortcut) {
    addWindowListeners(active);
    return;
  }
  const start = ++startCount;
  desktop
    .registerPushToTalk(shortcut, (pressed) => (pressed ? active.keyDown() : active.keyUp()))
    .then(
      (remove) => {
        if (start === startCount) {
          removeGlobalShortcut = remove;
        } else {
          remove();
        }
      },
      () => {
        // The system refused the shortcut (another app has it, for example).
        // The key then works only while this window has focus.
        if (start === startCount) {
          addWindowListeners(active);
        }
      },
    );
}

export function stopPushToTalkRuntime(): void {
  startCount += 1;
  if (keyDownHandler) window.removeEventListener("keydown", keyDownHandler);
  if (keyUpHandler) window.removeEventListener("keyup", keyUpHandler);
  if (blurHandler) window.removeEventListener("blur", blurHandler);
  if (visibilityHandler) document.removeEventListener("visibilitychange", visibilityHandler);
  removeGlobalShortcut?.();
  keyDownHandler = null;
  keyUpHandler = null;
  blurHandler = null;
  visibilityHandler = null;
  removeGlobalShortcut = null;
  controller?.dispose();
  controller = null;
}
