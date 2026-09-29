// Starts the crypto layer in the background once the session signs in,
// and stops it on sign-out. The crypto code and the WASM file load with a
// dynamic import, so they are not in the main bundle. Only one tab of a
// device runs the crypto layer: it holds a Web Lock. A different tab waits
// for the lock. See docs/concepts/olm-megolm.md.
import type { CryptoHandle } from "@discord-clone/client-core/crypto";
import { webPlatform } from "@discord-clone/client-core";
import { gatewaySend, subscribeDispatch } from "./realtime.js";
import { session } from "./session.js";

/** The debug hook for development and the end-to-end tests. Never in a production build. */
export interface CryptoDebug {
  ready(): boolean;
  identityKeys(): { curve25519: string; ed25519: string } | null;
  sessionCount(): Promise<number>;
  /** Send a `debug.ping` envelope to every device of a user. Returns the number of devices it reached. */
  sendPing(userId: string, text: string): Promise<number>;
  /** The `debug.ping` envelopes this device received. */
  received(): Array<{ fromUserId: string; fromDeviceId: string; text: string }>;
}

const MAX_RECEIVED = 100;

let handle: CryptoHandle | null = null;
let run = 0;
let releaseLock: (() => void) | null = null;
const received: Array<{ fromUserId: string; fromDeviceId: string; text: string }> = [];

function start(userId: string, deviceId: string): void {
  const current = ++run;
  if (typeof navigator === "undefined" || !navigator.locks) {
    return;
  }
  void navigator.locks
    .request(`crypto:${userId}:${deviceId}`, async () => {
      if (current !== run) {
        return;
      }
      const crypto = await import("@discord-clone/client-core/crypto");
      const started = await crypto.startCrypto({
        userId,
        deviceId,
        secureStore: webPlatform.secureStore,
        transport: crypto.createHttpCryptoTransport(session.apiClient, gatewaySend),
        log: (message) => console.warn(`[crypto] ${message}`),
      });
      if (current !== run) {
        started.stop();
        return;
      }
      handle = started;
      const unsubscribe = subscribeDispatch((event) => started.handleDispatch(event));
      started.onToDevice((event) => {
        if (event.type === "debug.ping" && typeof event.content.text === "string") {
          received.push({ fromUserId: event.sender.userId, fromDeviceId: event.sender.deviceId, text: event.content.text });
          received.splice(0, received.length - MAX_RECEIVED);
        }
      });
      // Hold the lock until sign-out.
      await new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      unsubscribe();
      started.stop();
    })
    .catch((error: unknown) => {
      console.warn("[crypto] The crypto layer could not start.", error);
    });
}

function stop(): void {
  run += 1;
  handle = null;
  received.length = 0;
  releaseLock?.();
  releaseLock = null;
}

let previousStatus = session.store.getState().status;
session.store.subscribe((state) => {
  if (state.status === "signedIn" && state.user && state.deviceId && previousStatus !== "signedIn") {
    start(state.user.id, state.deviceId);
  } else if (state.status === "signedOut" && previousStatus !== "signedOut") {
    stop();
  }
  previousStatus = state.status;
});

const initial = session.store.getState();
if (initial.status === "signedIn" && initial.user && initial.deviceId) {
  start(initial.user.id, initial.deviceId);
}

export const cryptoDebug: CryptoDebug = {
  ready: () => handle !== null,
  identityKeys: () => handle?.identityKeys ?? null,
  sessionCount: () => handle?.sessionCount() ?? Promise.resolve(0),
  async sendPing(userId, text) {
    if (!handle) {
      throw new Error("The crypto layer is not ready.");
    }
    const result = await handle.encryptToUsers([userId], "debug.ping", { text });
    return result.sent.length;
  },
  received: () => [...received],
};
