// The origin rules of the API and the gateway. The web app has the same
// origin as the server (one domain, see docs/architecture.md section 7).
// Other origins, such as the desktop app, must be in CORS_ALLOWED_ORIGINS.
// The API uses no cookies for auth, so CORS never sends credentials.
import type { AppConfig } from "./config.js";

/** Make the origin check for one config. */
export function createOriginCheck(config: Pick<AppConfig, "webOrigin" | "corsAllowedOrigins">) {
  const allowed = new Set(config.corsAllowedOrigins);
  try {
    allowed.add(new URL(config.webOrigin).origin);
  } catch {
    // A WEB_ORIGIN that is not a URL gives no extra origin.
  }

  /**
   * True when a request with this `Origin` header can use the server.
   * A request without the header does not come from a web page, so the
   * check lets it through. A browser always sends the header on a
   * WebSocket upgrade.
   */
  return function isAllowedOrigin(origin: string | undefined, host: string | undefined): boolean {
    if (origin === undefined) {
      return true;
    }
    if (allowed.has(origin)) {
      return true;
    }
    try {
      return host !== undefined && new URL(origin).host === host;
    } catch {
      return false;
    }
  };
}
