// The platform of the desktop app (Tauri). `main.tsx` loads this file with
// a dynamic import, only when the page runs in the desktop app. It gives:
//
// - the OS key store (Windows Credential Manager, macOS Keychain) as the
//   secure store,
// - system notifications, and link previews that the app fetches itself,
// - a global push-to-talk shortcut, a tray menu, an unread badge, deep
//   links and update prompts.
//
// See docs/concepts/desktop-shells.md.
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { navigate } from "wouter/use-browser-location";
import {
  countMentions,
  countUnreadMessages,
  type FetchLinkPreview,
  type LinkPreviewData,
  type NotifyOptions,
  type Platform,
} from "@discord-clone/client-core";
import { decodeBase64Url, decodeHtml, readHtmlMeta } from "@discord-clone/shared";
import { installDesktopPlatform, type DesktopFeatures } from "../lib/platform.js";
import { setServerOrigin } from "../lib/server-url.js";
import { messagesStore } from "../lib/messages.js";
import { realtimeStore } from "../lib/realtime.js";
import { toggleDeafen, toggleMute, voiceStore } from "../lib/voice.js";
import { commands, onDesktopEvent, type DesktopInit } from "./commands.js";
import { readCloseToTray } from "./close-to-tray.js";
import { startUpdateChecks } from "./updates.js";

/** One time limit for the page and its image, the same as the server route. */
const LINK_PREVIEW_TIMEOUT_MS = 3000;
/** The app keeps the click actions of this many recent notifications. */
const MAX_NOTIFICATION_ACTIONS = 50;
const INVITE_CODE = /^[A-Za-z0-9_-]{1,64}$/;

const notificationActions = new Map<string, () => void>();
let notificationCount = 0;
// Each start of the page has its own id prefix, so a click on an old notification does not run a new action.
const notificationPrefix = Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => (byte % 36).toString(36)).join("");

function notify(options: NotifyOptions): void {
  notificationCount += 1;
  const id = `${notificationPrefix}n${notificationCount}`;
  if (options.onClick) {
    notificationActions.set(id, options.onClick);
    if (notificationActions.size > MAX_NOTIFICATION_ACTIONS) {
      const oldest = notificationActions.keys().next().value;
      if (oldest !== undefined) notificationActions.delete(oldest);
    }
  }
  void commands.notify(id, options.title, options.body).catch(() => {
    // A notification is not worth an error message.
  });
}

async function fetchResource(url: string, kind: "page" | "image", deadline: number) {
  const resource = await commands.linkPreviewFetch(url, kind, Math.max(0, deadline - Date.now()));
  return { ...resource, bytes: decodeBase64Url(resource.body) };
}

/** Fetch a page and its image here, with the same address rules as the server route. */
const fetchLinkPreview: FetchLinkPreview = async (url) => {
  const deadline = Date.now() + LINK_PREVIEW_TIMEOUT_MS;
  let page;
  try {
    page = await fetchResource(url, "page", deadline);
  } catch {
    return null;
  }
  const meta = readHtmlMeta(decodeHtml(page.bytes, page.contentType));
  let image: LinkPreviewData["image"];
  if (meta.image) {
    try {
      const fetched = await fetchResource(new URL(meta.image, page.url).href, "image", deadline);
      image = { bytes: fetched.bytes, mime: fetched.contentType };
    } catch {
      // A preview without its image is still a preview.
    }
  }
  if (!meta.title && !meta.description && !image) {
    return null;
  }
  return { url, title: meta.title, description: meta.description, siteName: meta.siteName, image };
};

const platform: Platform = {
  secureStore: {
    get: (key) => commands.secureGet(key),
    set: (key, value) => commands.secureSet(key, value),
    delete: (key) => commands.secureDelete(key),
  },
  notify,
  fetchLinkPreview,
};

function makeFeatures(init: DesktopInit): DesktopFeatures {
  return {
    os: init.os,
    screenShareUnavailableReason:
      init.os === "macos" ? "Screen share is not available in this app on macOS. Use the web app." : null,
    async registerPushToTalk(shortcut, onChange) {
      const unlisten = await onDesktopEvent("push-to-talk", onChange);
      try {
        await commands.setPushToTalk(shortcut);
      } catch (error) {
        unlisten();
        throw error;
      }
      return () => {
        unlisten();
        void commands.setPushToTalk(null).catch(() => {});
      };
    },
    openExternal: (url) => commands.openUrl(url),
  };
}

/**
 * Open a deep link: "discordclone://invite/<code>", "discordclone://auth/callback#code=<code>"
 * or "discordclone://notification/<id>".
 */
function openDeepLink(link: string): void {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return;
  }
  // In "discordclone://invite/abc", the host is "invite" and the path is "/abc".
  const parts = `${url.host}${url.pathname}`.split("/").filter((part) => part.length > 0);
  if (parts[0] === "invite" && parts.length === 2 && INVITE_CODE.test(parts[1]!)) {
    navigate(`/invite/${parts[1]}`);
  } else if (parts[0] === "auth" && parts[1] === "callback" && parts.length === 2) {
    navigate(`/auth/callback${url.hash}`);
  } else if (parts[0] === "notification" && parts.length === 2) {
    // A click on a notification (Windows). The id is unknown after a restart: the window then only shows.
    notificationActions.get(parts[1]!)?.();
  }
}

/** The number on the taskbar or dock icon: unread direct messages and mentions. */
function unreadCount(): number {
  const { channels, selfUserId } = messagesStore.getState();
  const { privateChannels } = realtimeStore.getState();
  let count = 0;
  for (const [id, channel] of Object.entries(channels)) {
    count += privateChannels[id] ? countUnreadMessages(channel, selfUserId) : countMentions(channel, selfUserId);
  }
  return count;
}

/** Keep the badge up to date. The stores change often, so the count goes out at most 4 times each second. */
function watchUnreadBadge(): void {
  let sent = -1;
  let scheduled = false;
  const update = () => {
    scheduled = false;
    const count = unreadCount();
    if (count !== sent) {
      sent = count;
      void commands.setUnreadBadge(count).catch(() => {});
    }
  };
  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      // Not an animation frame: a window in the tray gets none.
      setTimeout(update, 250);
    }
  };
  messagesStore.subscribe(schedule);
  realtimeStore.subscribe(schedule);
}

/** Tell the tray menu the call state, and do what the tray menu asks. */
function wireTray(): void {
  let last = "";
  voiceStore.subscribe((state) => {
    const inCall = state.status === "connected";
    const key = `${inCall}:${state.muted}:${state.deafened}`;
    if (key !== last) {
      last = key;
      void commands.setVoiceState(inCall, state.muted, state.deafened).catch(() => {});
    }
  });
  void onDesktopEvent("tray-action", (action) => {
    if (action === "mute") toggleMute();
    else if (action === "deafen") toggleDeafen();
  });
}

/** Show the server address page. The app restarts once the user saves an address, so this never resolves. */
async function askForServer(root: HTMLElement): Promise<never> {
  const { ServerAddressPage } = await import("./ServerAddressPage.js");
  createRoot(root).render(createElement(ServerAddressPage));
  return new Promise<never>(() => {});
}

/** Set up the desktop platform. `main.tsx` calls this before the app renders. */
export async function startDesktop(root: HTMLElement): Promise<void> {
  const init = await commands.init();
  if (!init.serverUrl) {
    await askForServer(root);
  }
  setServerOrigin(init.serverUrl ?? "");
  installDesktopPlatform(platform, makeFeatures(init));

  void onDesktopEvent("deep-link", (links) => links.forEach(openDeepLink));
  void commands.setCloseToTray(readCloseToTray()).catch(() => {});
  wireTray();
  watchUnreadBadge();
  startUpdateChecks();
  // The router starts after this function returns, so the start links open then.
  setTimeout(() => init.deepLinks.forEach(openDeepLink), 0);
}
