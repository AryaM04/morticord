// The one synced settings store for this tab. It reads the settings after
// each READY and again when another session announces a new version. It
// forgets everything on sign-out.
import { useStore } from "zustand";
import { createSettingsStore, type SettingsStore } from "@discord-clone/client-core";
import { session } from "./session.js";
import { realtimeStore } from "./realtime.js";

export const settingsStore = createSettingsStore(session.apiClient);

export function useSettings<T>(selector: (state: SettingsStore) => T): T {
  return useStore(settingsStore, selector);
}

function loadSettings(): void {
  settingsStore
    .getState()
    .load()
    .catch((error: unknown) => {
      console.warn("The synced settings did not load.", error);
    });
}

realtimeStore.subscribe((state, previous) => {
  if (state.sessionId !== previous.sessionId) {
    if (state.sessionId === null) {
      settingsStore.getState().reset();
    } else {
      loadSettings();
    }
  }
  if (state.remoteSettingsVersion !== null && state.remoteSettingsVersion !== previous.remoteSettingsVersion) {
    settingsStore
      .getState()
      .applyRemoteVersion(state.remoteSettingsVersion)
      .catch((error: unknown) => {
        console.warn("The new synced settings did not load.", error);
      });
  }
});
