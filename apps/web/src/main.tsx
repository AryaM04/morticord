// Web app entry point.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { VoiceDebugPeerStats } from "@discord-clone/client-core/voice";
import { App } from "./App.js";
import { getVoiceDebugStats, isLocalVoiceTrackEnabled } from "./lib/voice.js";
import "./theme.css";

declare global {
  interface Window {
    /** A voice call's raw stats, for the voice end-to-end test only. See CLAUDE.md: never in a production build. */
    __voiceDebug?: {
      getStats(): Promise<VoiceDebugPeerStats[]>;
      isLocalTrackEnabled(): boolean | null;
    };
  }
}

// Expose voice debug stats only in a dev build or a test run, never in
// production: this hook exists for the voice end-to-end test alone.
if (import.meta.env.DEV || import.meta.env.MODE === "test") {
  window.__voiceDebug = {
    getStats: getVoiceDebugStats,
    isLocalTrackEnabled: isLocalVoiceTrackEnabled,
  };
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found. Check the id in index.html.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
