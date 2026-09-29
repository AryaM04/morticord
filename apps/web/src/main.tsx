// Web app entry point.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { VoiceDebugPeerStats } from "@discord-clone/client-core/voice";
import { App } from "./App.js";
import { cryptoDebug, type CryptoDebug } from "./lib/crypto.js";
import { getVoiceDebugStats, isLocalVoiceTrackEnabled } from "./lib/voice.js";
import "./theme.css";

declare global {
  interface Window {
    /** A voice call's raw stats, for the voice end-to-end test only. See CLAUDE.md: never in a production build. */
    __voiceDebug?: {
      getStats(): Promise<VoiceDebugPeerStats[]>;
      isLocalTrackEnabled(): boolean | null;
    };
    /** The crypto layer state, for the E2EE end-to-end test only. Never in a production build. */
    __cryptoDebug?: CryptoDebug;
  }
}

// Expose voice debug stats only in a dev build or a test run, never in
// production: this hook exists for the voice end-to-end test alone.
if (import.meta.env.DEV || import.meta.env.MODE === "test") {
  window.__voiceDebug = {
    getStats: getVoiceDebugStats,
    isLocalTrackEnabled: isLocalVoiceTrackEnabled,
  };
  window.__cryptoDebug = cryptoDebug;
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found. Check the id in index.html.");
}

/**
 * The desktop app (Tauri) puts `__TAURI_INTERNALS__` on the window. Its
 * platform loads with a dynamic import, so the web bundle does not grow.
 * It sets the server address and the platform before the app renders.
 */
async function start(root: HTMLElement): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    const { startDesktop } = await import("./desktop/tauri-platform.js");
    await startDesktop(root);
  }
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start(rootElement);
