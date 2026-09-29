// The commands and events of the desktop app (Tauri). The Rust side is in
// apps/desktop-tauri/src-tauri/src. Only the desktop platform loads this
// file, so the web bundle does not include it.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type DesktopOs = "windows" | "macos" | "linux";

/** The start data of the app. */
export interface DesktopInit {
  os: DesktopOs;
  version: string;
  /** The server origin that the user chose, or null before the first choice. */
  serverUrl: string | null;
  /** The deep links that started the app, such as "discordclone://invite/abc". */
  deepLinks: string[];
}

/** A page or an image that the app fetched for a link preview. */
export interface FetchedResource {
  /** The URL after redirects. */
  url: string;
  contentType: string;
  /** The body, as base64url. */
  body: string;
}

export interface UpdateInfo {
  version: string;
  notes: string | null;
}

export const commands = {
  init: () => invoke<DesktopInit>("desktop_init"),
  secureGet: (key: string) => invoke<string | null>("secure_get", { key }),
  secureSet: (key: string, value: string) => invoke<void>("secure_set", { key, value }),
  secureDelete: (key: string) => invoke<void>("secure_delete", { key }),
  /** Check that a server answers and allows this app (CORS). Returns the server origin. */
  checkServer: (url: string) => invoke<string>("check_server", { url }),
  /** Keep the server origin (null forgets it) and restart the app, so the new content policy applies. */
  setServerUrl: (url: string | null) => invoke<void>("set_server_url", { url }),
  linkPreviewFetch: (url: string, kind: "page" | "image", timeoutMs: number) =>
    invoke<FetchedResource>("link_preview_fetch", { url, kind, timeoutMs }),
  notify: (id: string, title: string, body: string) => invoke<void>("notify", { id, title, body }),
  setPushToTalk: (shortcut: string | null) => invoke<void>("set_push_to_talk", { shortcut }),
  setVoiceState: (inCall: boolean, muted: boolean, deafened: boolean) =>
    invoke<void>("set_voice_state", { inCall, muted, deafened }),
  setCloseToTray: (enabled: boolean) => invoke<void>("set_close_to_tray", { enabled }),
  setUnreadBadge: (count: number) => invoke<void>("set_unread_badge", { count }),
  checkUpdate: () => invoke<UpdateInfo | null>("check_update"),
  installUpdate: () => invoke<void>("install_update"),
  openUrl: (url: string) => invoke<void>("plugin:opener|open_url", { url }),
};

/** The events that the Rust side sends to the window. */
export interface DesktopEvents {
  "deep-link": string[];
  "push-to-talk": boolean;
  "tray-action": "mute" | "deafen";
}

export function onDesktopEvent<K extends keyof DesktopEvents>(
  name: K,
  handler: (payload: DesktopEvents[K]) => void,
): Promise<UnlistenFn> {
  return listen<DesktopEvents[K]>(name, (event) => handler(event.payload));
}
