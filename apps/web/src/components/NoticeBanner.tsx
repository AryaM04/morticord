// A banner for a live-event notice: shown once (for example, "you were
// removed from this server") and cleared after a short delay or on close.
import { useStore } from "zustand";
import { clearNotice, noticeStore } from "../lib/notice.js";

export function NoticeBanner() {
  const message = useStore(noticeStore, (s) => s.message);
  if (!message) {
    return null;
  }
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-2 px-3 py-2 text-center text-sm"
      style={{ backgroundColor: "#3a2f00", color: "#ffe0a3" }}
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={clearNotice}
        aria-label="Dismiss notice"
        className="px-2 text-sm"
      >
        &times;
      </button>
    </div>
  );
}
