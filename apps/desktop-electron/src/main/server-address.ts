// The server address of the Linux app. The user types it on the first
// start (the server address page of the web app). The app checks that the
// server answers and allows the app origin (CORS). The address is not a
// secret, so it lives in the settings file, not in the secure store.
import { isIP } from "node:net";

const CHECK_TIMEOUT_MS = 5000;
const INVALID = "Type a server address such as chat.example.com or https://192.168.1.5.";

/** True for a host name that is this computer. Chromium lets a secure page connect to it over http. */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  if (isIP(host) === 4) {
    return host.startsWith("127.");
  }
  return host === "::1";
}

/**
 * The origin of a server address, such as "https://chat.example.com" for
 * "chat.example.com". The address can have only a scheme (default https),
 * a host, a port and a "/" path. The app window is a secure page, and
 * Chromium blocks http from a secure page, so http is allowed only for
 * this computer (localhost).
 */
export function normalizeServerAddress(input: string): string {
  const trimmed = input.trim();
  const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(INVALID);
  }
  const simple =
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.hostname !== "" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "" &&
    !withScheme.endsWith("?") &&
    !withScheme.endsWith("#");
  if (!simple) {
    throw new Error(INVALID);
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    throw new Error("The Linux app needs an https address. It accepts http only for localhost.");
  }
  return url.origin;
}

/**
 * Check that a server answers `GET /api/v1/health` and allows this app
 * (CORS). Send the app origin in the Origin header, as the window does.
 * Returns the server origin.
 */
export async function checkServer(
  input: string,
  appOrigin: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const origin = normalizeServerAddress(input);
  let response: Response;
  try {
    response = await fetchFn(`${origin}/api/v1/health`, {
      headers: { origin: appOrigin },
      redirect: "manual",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
  } catch {
    throw new Error(`The server at ${origin} did not answer. Check the address.`);
  }
  await response.body?.cancel();
  if (response.status !== 200) {
    throw new Error(`The server at ${origin} is not ready (HTTP status ${response.status}). Check the address.`);
  }
  const allowed = response.headers.get("access-control-allow-origin");
  if (allowed !== appOrigin && allowed !== "*") {
    throw new Error(
      `The server does not allow this app. Add ${appOrigin} to CORS_ALLOWED_ORIGINS in the .env file of the server.`,
    );
  }
  return origin;
}
