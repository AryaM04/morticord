// Wires the pure `PushToTalkController` to real browser events: key
// down/up on `window`, and the two ways a page loses the ability to see
// further key events (losing focus, or being hidden). Push to talk works
// only while this window has focus; the desktop app adds a global key in
// a later milestone, through `platform`.
import { isPttKeyAllowedWhileTyping, isTypingTarget, PushToTalkController } from "./ptt.js";
import { voiceDeviceSettingsStore } from "./voice-settings.js";

let controller: PushToTalkController | null = null;
let keyDownHandler: ((event: KeyboardEvent) => void) | null = null;
let keyUpHandler: ((event: KeyboardEvent) => void) | null = null;
let blurHandler: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;

/** Starts listening for the push-to-talk key. Call once per call; call `stopPushToTalkRuntime` before calling again. */
export function startPushToTalkRuntime(onActiveChange: (active: boolean) => void): void {
  stopPushToTalkRuntime();
  controller = new PushToTalkController(onActiveChange);

  keyDownHandler = (event: KeyboardEvent) => {
    const pttKeyCode = voiceDeviceSettingsStore.getState().pttKeyCode;
    if (!pttKeyCode || event.code !== pttKeyCode) {
      return;
    }
    if (isTypingTarget(event.target) && !isPttKeyAllowedWhileTyping(event.key)) {
      return;
    }
    event.preventDefault();
    controller?.keyDown();
  };
  keyUpHandler = (event: KeyboardEvent) => {
    const pttKeyCode = voiceDeviceSettingsStore.getState().pttKeyCode;
    if (!pttKeyCode || event.code !== pttKeyCode) {
      return;
    }
    controller?.keyUp();
  };
  blurHandler = () => controller?.releaseNow();
  visibilityHandler = () => {
    if (document.visibilityState === "hidden") {
      controller?.releaseNow();
    }
  };

  window.addEventListener("keydown", keyDownHandler);
  window.addEventListener("keyup", keyUpHandler);
  window.addEventListener("blur", blurHandler);
  document.addEventListener("visibilitychange", visibilityHandler);
}

export function stopPushToTalkRuntime(): void {
  if (keyDownHandler) window.removeEventListener("keydown", keyDownHandler);
  if (keyUpHandler) window.removeEventListener("keyup", keyUpHandler);
  if (blurHandler) window.removeEventListener("blur", blurHandler);
  if (visibilityHandler) document.removeEventListener("visibilitychange", visibilityHandler);
  keyDownHandler = null;
  keyUpHandler = null;
  blurHandler = null;
  visibilityHandler = null;
  controller?.dispose();
  controller = null;
}
