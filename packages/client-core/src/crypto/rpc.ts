// The messages between the tabs and the crypto SharedWorker, and the part
// of the crypto layer that a tab can use. The tab side is `client.ts`, the
// worker side is `host.ts`. See docs/concepts/olm-megolm.md section 13.
import { ApiError } from "../api.js";
import type { DecryptedToDevice } from "./olm-machine.js";
import type { CryptoHandle, RestoreProgress, RestoreResult } from "./index.js";
import type { CryptoTransport } from "./transport.js";
import type { VerificationView } from "./verification.js";

/** The part of the crypto layer that a tab uses. The worker client and the in-page handle both give it. */
export type CryptoClient = Pick<
  CryptoHandle,
  | "userId"
  | "deviceId"
  | "identityKeys"
  | "codec"
  | "hasMegolmSession"
  | "handleDispatch"
  | "encryptToDevices"
  | "encryptToUsers"
  | "onToDevice"
  | "settings"
  | "sessionCount"
  | "changedMasterKeys"
  | "security"
  | "verification"
  | "search"
  | "stop"
>;

type Codec = Required<CryptoClient["codec"]>;
type Security = CryptoClient["security"];
type Verification = CryptoClient["verification"];

/** The calls that a tab can make. The worker answers each one with a result or an error. */
export interface CallSignatures {
  "codec.encode": Codec["encode"];
  "codec.decode": Codec["decode"];
  hasMegolmSession: CryptoClient["hasMegolmSession"];
  encryptToDevices: CryptoClient["encryptToDevices"];
  encryptToUsers: CryptoClient["encryptToUsers"];
  "settings.open": CryptoClient["settings"]["open"];
  "settings.seal": CryptoClient["settings"]["seal"];
  sessionCount: CryptoClient["sessionCount"];
  changedMasterKeys: CryptoClient["changedMasterKeys"];
  "security.state": Security["state"];
  "security.ownDevices": Security["ownDevices"];
  "security.userTrust": Security["userTrust"];
  "security.acceptIdentityChange": Security["acceptIdentityChange"];
  /** The worker keeps `create` and gives a token for it. */
  "security.setUpBackup": (passphrase?: string) => Promise<{ recoveryKey: string; token: string }>;
  "security.createBackup": (token: string) => Promise<void>;
  /** The worker sends `progress` messages with the id of the call. */
  "security.restoreBackup": (input: { recoveryKey: string } | { passphrase: string }) => Promise<RestoreResult>;
  "security.deleteBackup": Security["deleteBackup"];
  "security.resetIdentity": Security["resetIdentity"];
  "verification.requestOwnDevices": Verification["requestOwnDevices"];
  "verification.requestUser": Verification["requestUser"];
  "verification.accept": Verification["accept"];
  "verification.confirm": Verification["confirm"];
  "verification.cancel": Verification["cancel"];
  "verification.dismiss": Verification["dismiss"];
  "search.apply": CryptoClient["search"]["apply"];
  "search.query": CryptoClient["search"]["query"];
}

export type CallMethod = keyof CallSignatures;
export type TransportMethod = keyof CryptoTransport;

/** An error as it crosses the port. `ApiError` keeps its status and code. */
export interface RpcError {
  name: string;
  message: string;
  code?: string;
  status?: number;
}

/** The events that the worker sends to every tab. */
export type CryptoEvent =
  | { type: "keys"; channelId: string; sessionId: string }
  | { type: "toDevice"; event: DecryptedToDevice }
  | { type: "settingsKey"; keyId: string }
  | { type: "security" }
  | { type: "verification"; verifications: VerificationView[] };

/** A message from a tab to the worker. */
export type TabMessage =
  /** The first message. The tab holds the lock `tabLock` while it lives. */
  | { kind: "hello"; userId: string; deviceId: string; tabLock: string }
  | { kind: "call"; id: number; method: CallMethod; args: unknown[] }
  | { kind: "dispatch"; dispatch: { t: string; d: unknown } }
  /** The users that the gateway of the tab shows as offline. */
  | { kind: "presence"; offline: string[] }
  | { kind: "transportResult"; id: number; value?: unknown; error?: RpcError };

/** The state of the crypto layer in the worker. */
export type WorkerState =
  /** A different context (an old build, or a tab without the worker) holds the device lock. */
  | { state: "waiting" }
  | { state: "ready"; identityKeys: { curve25519: string; ed25519: string }; verifications: VerificationView[] }
  | { state: "failed"; error: RpcError };

/** A message from the worker to a tab. */
export type WorkerMessage =
  /** The worker holds the lock `workerLock` while it lives. */
  | { kind: "welcome"; workerLock: string }
  | ({ kind: "state" } & WorkerState)
  | { kind: "result"; id: number; value?: unknown; error?: RpcError }
  | { kind: "progress"; id: number; progress: RestoreProgress }
  | { kind: "event"; event: CryptoEvent }
  /** A network call that the worker asks the tab to make with its session and its gateway. */
  | { kind: "transport"; id: number; method: TransportMethod; args: unknown[] };

/** The part of `navigator.locks` that the RPC uses. Tests give a fake one. */
export interface LockManagerLike {
  request(name: string, callback: (lock: unknown) => Promise<unknown> | unknown): Promise<unknown>;
  request(
    name: string,
    options: { ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: unknown) => Promise<unknown> | unknown,
  ): Promise<unknown>;
}

export function toRpcError(error: unknown): RpcError {
  if (error instanceof ApiError) {
    return { name: error.name, message: error.message, code: error.code, status: error.status };
  }
  if (error instanceof Error) {
    const { code, status } = error as { code?: unknown; status?: unknown };
    return {
      name: error.name,
      message: error.message,
      ...(typeof code === "string" ? { code } : {}),
      ...(typeof status === "number" ? { status } : {}),
    };
  }
  return { name: "Error", message: String(error) };
}

export function fromRpcError(error: RpcError): Error {
  if (error.name === "ApiError") {
    return new ApiError(error.status ?? 0, error.code ?? "UNKNOWN", error.message);
  }
  return Object.assign(new Error(error.message), {
    name: error.name,
    ...(error.code !== undefined ? { code: error.code } : {}),
    ...(error.status !== undefined ? { status: error.status } : {}),
  });
}

/** A random id for a lock name or a token. */
export function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
