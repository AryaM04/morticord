// The address of the server. In a browser, the server is the page origin,
// so every URL stays relative. The desktop app loads this web build from
// its own origin, and sets the server origin once at start (see
// `desktop/tauri-platform.ts`). Every REST, gateway, avatar and attachment
// URL goes through this file.

/** The server origin, such as "https://chat.example.com". Empty: the page origin. */
let origin = "";

/** Set the server origin. Call this only at start, before the app renders. */
export function setServerOrigin(value: string): void {
  origin = value;
}

/** The server origin, or an empty text when the server is the page origin. */
export function serverOrigin(): string {
  return origin;
}

/** A URL on the server, for a path such as "/api/v1/avatars/1/abc". */
export function serverUrl(path: string): string {
  return `${origin}${path}`;
}

/** The base URL of the REST API. */
export function apiBaseUrl(): string {
  return serverUrl("/api/v1");
}

/** The gateway WebSocket URL: ws: for an http server, wss: for an https server. */
export function gatewayUrl(): string {
  const base = new URL(origin || window.location.origin);
  const protocol = base.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${base.host}/gateway`;
}

/** The web address of a page of the web app, such as an invite link. The desktop app has no public pages, so it uses the server. */
export function webPageUrl(path: string): string {
  return `${origin || window.location.origin}${path}`;
}
