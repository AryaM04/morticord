// The synced settings: one JSON object for each user, kept on the server
// through the settings API. This store is the single place for synced
// settings (hidden DMs, notification levels, the ring sound).
//
// A change applies at once on this device. Then the store saves it. When
// another device saved first (VERSION_CONFLICT), the store reads the new
// server copy, puts the local changes on top key by key, and tries one
// more time. See docs/concepts/dms-and-friends.md.
import { createStore, type StoreApi } from "zustand/vanilla";
import { ApiError, type ApiClient } from "./api.js";
import { compareIds } from "./messages-store.js";
import { getSettings, putSettings, settingsBytes } from "./settings-api.js";

export type NotificationLevel = "all" | "mentions" | "none";

/** The level of a guild with no saved level. */
export const DEFAULT_NOTIFICATION_LEVEL: NotificationLevel = "mentions";

/**
 * The synced values. Every key is optional: an old or new client can
 * write keys that this client does not know. The store keeps those keys.
 */
export interface SettingsValues {
  [key: string]: unknown;
  /**
   * DMs that the user closed. The value is the newest event id of the DM
   * at the time of the close (null for an empty DM). A newer event opens the DM again.
   */
  hiddenDms?: Record<string, string | null>;
  /** The notification level of each guild, by guild id. */
  notificationLevels?: Record<string, NotificationLevel>;
  /** Play a sound for an incoming DM call. True when not set. */
  playRingSound?: boolean;
}

export interface SettingsState {
  /** True after the first read from the server. */
  loaded: boolean;
  /** The server version that `values` is based on. */
  version: number;
  values: SettingsValues;
  /** The last save error, in words for people. Null after a save that worked. */
  error: string | null;
}

export interface SettingsActions {
  /** Read the settings from the server. Local changes that are not saved yet stay on top. */
  load(): Promise<void>;
  /** Change some keys. The change applies at once and the store saves it. */
  update(patch: SettingsValues): Promise<void>;
  /** Another session saved a new version. Read it when it is newer than the local version. */
  applyRemoteVersion(version: number): Promise<void>;
  reset(): void;
}

export type SettingsStore = SettingsState & SettingsActions;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Decode the settings bytes. Bad or missing data gives an empty object. */
export function decodeSettings(bytes: Uint8Array | null): SettingsValues {
  if (!bytes) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function encodeSettings(values: SettingsValues): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(values));
}

// ---- typed reads with safe defaults ------------------------------------------

export function notificationLevelOf(values: SettingsValues, guildId: string): NotificationLevel {
  const level = isRecord(values.notificationLevels) ? values.notificationLevels[guildId] : undefined;
  return level === "all" || level === "mentions" || level === "none" ? level : DEFAULT_NOTIFICATION_LEVEL;
}

export function playRingSoundOf(values: SettingsValues): boolean {
  return values.playRingSound !== false;
}

export function hiddenDmsOf(values: SettingsValues): Record<string, string | null> {
  return isRecord(values.hiddenDms) ? (values.hiddenDms as Record<string, string | null>) : {};
}

/**
 * True when the user closed this DM and no newer event came after the close.
 * `lastEventId` is the newest event id of the DM that this client knows.
 */
export function isDmHidden(values: SettingsValues, channelId: string, lastEventId: string | null): boolean {
  const hidden = hiddenDmsOf(values);
  if (!(channelId in hidden)) {
    return false;
  }
  const hiddenAt = hidden[channelId] ?? null;
  if (lastEventId === null) {
    return true;
  }
  return hiddenAt !== null && compareIds(lastEventId, hiddenAt) <= 0;
}

// ---- the store ------------------------------------------------------------------

export function createInitialSettingsState(): SettingsState {
  return { loaded: false, version: 0, values: {}, error: null };
}

function describeSaveError(error: unknown): string {
  return error instanceof Error ? error.message : "The settings were not saved.";
}

export function createSettingsStore(api: ApiClient): StoreApi<SettingsStore> {
  // Keys changed on this device and not saved yet. They win over the server copy.
  let unsaved: SettingsValues = {};
  // One save at a time. A change during a save goes into the next save.
  let saving: Promise<void> | null = null;
  // Each reset starts a new generation. A save from an old generation must not write.
  let generation = 0;

  const store = createStore<SettingsStore>((set, get) => {
    async function readServer(): Promise<{ values: SettingsValues; version: number }> {
      const response = await getSettings(api);
      return { values: decodeSettings(settingsBytes(response)), version: response.version };
    }

    async function saveOnce(patch: SettingsValues, own: number): Promise<void> {
      const { values, version } = get();
      try {
        const response = await putSettings(api, encodeSettings(values), version);
        if (own !== generation) return;
        set({ version: response.version, error: null });
        return;
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "VERSION_CONFLICT") {
          throw error;
        }
      }
      // Another device saved first. Merge by key, with the local keys on top, and try one more time.
      const server = await readServer();
      if (own !== generation) return;
      set({ values: { ...server.values, ...patch, ...unsaved }, version: server.version });
      const response = await putSettings(api, encodeSettings(get().values), server.version);
      if (own !== generation) return;
      set({ version: response.version, error: null });
    }

    async function saveLoop(own: number): Promise<void> {
      while (own === generation && Object.keys(unsaved).length > 0) {
        const patch = unsaved;
        unsaved = {};
        try {
          await saveOnce(patch, own);
        } catch (error) {
          if (own !== generation) return;
          set({ error: describeSaveError(error) });
          // Show the server copy again, so this device does not keep a value that the server does not have.
          try {
            const server = await readServer();
            if (own === generation) {
              set({ values: { ...server.values, ...unsaved }, version: server.version, loaded: true });
            }
          } catch {
            // Keep the local copy. The next change or the next announcement tries again.
          }
          return;
        }
      }
    }

    function startSave(): Promise<void> {
      if (!saving) {
        const own = generation;
        saving = saveLoop(own).finally(() => {
          if (own === generation) saving = null;
        });
      }
      return saving;
    }

    return {
      ...createInitialSettingsState(),

      async load() {
        const own = generation;
        const server = await readServer();
        if (own !== generation) return;
        set({ values: { ...server.values, ...unsaved }, version: server.version, loaded: true });
      },

      update(patch) {
        unsaved = { ...unsaved, ...patch };
        set({ values: { ...get().values, ...patch } });
        return startSave();
      },

      async applyRemoteVersion(version) {
        if (version <= get().version) return;
        // A save that runs now gets a conflict and merges by itself. Wait for it, then check again.
        if (saving) {
          await saving;
          if (version <= get().version) return;
        }
        await get().load();
      },

      reset() {
        generation += 1;
        unsaved = {};
        saving = null;
        set(createInitialSettingsState());
      },
    };
  });
  return store;
}
