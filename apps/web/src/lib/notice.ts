// A tiny, one-message-at-a-time notice banner: used for live events the
// person did not just trigger themselves (losing a channel, being kicked
// or banned), so they see a plain-word reason instead of a silent redirect.
import { createStore } from "zustand/vanilla";

export interface NoticeState {
  message: string | null;
}

export const noticeStore = createStore<NoticeState>(() => ({ message: null }));

let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function showNotice(message: string, timeoutMs = 6000): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
  }
  noticeStore.setState({ message });
  hideTimer = setTimeout(() => {
    noticeStore.setState({ message: null });
  }, timeoutMs);
}

export function clearNotice(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  noticeStore.setState({ message: null });
}
