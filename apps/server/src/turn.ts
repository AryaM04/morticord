// TURN credentials for coturn's use-auth-secret mode.
//
// The server never gives a client the long-term TURN secret. Instead, it
// signs a short-lived username with that secret. coturn checks the same
// signature, so it needs no database lookup for each call.
// See docs/concepts/nat-turn.md for the full idea.
import { createHmac } from "node:crypto";

export interface TurnCredentials {
  /** The TURN username. It holds the expiry time and the user id. */
  username: string;
  /** The TURN password, an HMAC-SHA1 of the username, as base64 text. */
  credential: string;
}

/**
 * Build one set of time-limited TURN credentials for one user.
 *
 * @param secret - The shared TURN secret. It must match the coturn
 *   `static-auth-secret` value, or coturn will reject the credentials.
 * @param userId - The id of the user these credentials belong to.
 * @param ttlSeconds - How many seconds the credentials stay valid.
 */
export function createTurnCredentials(
  secret: string,
  userId: string,
  ttlSeconds: number,
): TurnCredentials {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiry}:${userId}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return { username, credential };
}
