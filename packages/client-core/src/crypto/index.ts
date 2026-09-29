// The crypto layer entry point. The web app loads this module with a
// dynamic import after sign-in, so the WASM file and this code stay out of
// the main bundle. See docs/concepts/olm-megolm.md.
import {
  decodeBase64Url,
  deviceListUpdatePayloadSchema,
  encodeBase64Url,
  readyPayloadSchema,
  toDeviceDispatchPayloadSchema,
  type DeviceRef,
  type ToDeviceDispatchPayload,
} from "@discord-clone/shared";
import type { SecureStore } from "../platform.js";
import { AccountHolder } from "./account.js";
import { DeviceList } from "./device-list.js";
import { DeviceManager } from "./device-manager.js";
import { OlmMachine, type EncryptResult, type ToDeviceHandler } from "./olm-machine.js";
import { KeyedQueue } from "./queue.js";
import { cryptoStoreName, openCryptoStore, type CryptoStore } from "./store.js";
import type { CryptoTransport } from "./transport.js";
import { loadWasm } from "./wasm.js";

export { createHttpCryptoTransport, type CryptoTransport } from "./transport.js";
export type { DecryptedToDevice, EncryptResult, ToDeviceHandler } from "./olm-machine.js";
export type { DeviceRecord, UserRecord } from "./store.js";

/** Send at most one TO_DEVICE_ACK in this time, unless the local queue is empty for longer. */
const ACK_INTERVAL_MS = 2000;

export interface StartCryptoOptions {
  userId: string;
  deviceId: string;
  transport: CryptoTransport;
  secureStore: SecureStore;
  /** The IndexedDB factory. Tests pass a fake one. */
  indexedDb?: IDBFactory;
  log?: (message: string) => void;
  now?: () => number;
}

export interface CryptoHandle {
  readonly userId: string;
  readonly deviceId: string;
  readonly identityKeys: { curve25519: string; ed25519: string };
  readonly devices: DeviceList;
  /** Feed every gateway dispatch here. It uses READY, RESUMED, TO_DEVICE and DEVICE_LIST_UPDATE. */
  handleDispatch(dispatch: { t: string; d: unknown }): void;
  /** Encrypt and send one envelope to each device. */
  encryptToDevices(targets: DeviceRef[], type: string, content: Record<string, unknown>): Promise<EncryptResult>;
  /** Encrypt and send one envelope to every device of these users, except this device. */
  encryptToUsers(userIds: string[], type: string, content: Record<string, unknown>): Promise<EncryptResult>;
  onToDevice(handler: ToDeviceHandler): () => void;
  sessionCount(): Promise<number>;
  /** Users whose master key changed. The UI must warn about each one. */
  changedMasterKeys(): Promise<string[]>;
  onMasterKeyChanged(listener: (userId: string) => void): () => void;
  /** Wait until every received message is processed. For tests. */
  whenIdle(): Promise<void>;
  stop(): void;
}

/** Get the pickle key of this device, or make one. It is kept only in the platform secure store. */
async function loadPickleKey(secureStore: SecureStore, userId: string, deviceId: string): Promise<Uint8Array> {
  const name = `crypto-pickle-key:${userId}:${deviceId}`;
  const stored = await secureStore.get(name);
  if (stored) {
    return decodeBase64Url(stored);
  }
  const key = crypto.getRandomValues(new Uint8Array(32));
  await secureStore.set(name, encodeBase64Url(key));
  return key;
}

/**
 * Start the crypto layer of one device: load or make the account, set up
 * the keys on the server and start to handle to-device messages. The
 * caller must make sure that only one tab of a device runs it (a Web Lock).
 */
export async function startCrypto(options: StartCryptoOptions): Promise<CryptoHandle> {
  const { userId, deviceId, transport } = options;
  const log = options.log ?? (() => {});
  const wasm = await loadWasm();
  const pickleKey = await loadPickleKey(options.secureStore, userId, deviceId);
  const store: CryptoStore = await openCryptoStore(cryptoStoreName(userId, deviceId), options.indexedDb);
  const queue = new KeyedQueue();
  const account = await AccountHolder.load(wasm, store, pickleKey, queue);

  const masterKeyListeners = new Set<(userId: string) => void>();
  const devices = new DeviceList({
    store,
    transport,
    wasm,
    queue,
    now: options.now,
    onMasterKeyChanged: (changedUserId) => {
      for (const listener of masterKeyListeners) {
        listener(changedUserId);
      }
    },
  });
  await devices.trackUsers([userId]);

  const manager = new DeviceManager({ wasm, store, transport, account, deviceList: devices, pickleKey, userId, deviceId });
  const olm = new OlmMachine({
    wasm,
    store,
    transport,
    deviceList: devices,
    account,
    queue,
    pickleKey,
    userId,
    deviceId,
    now: options.now,
    log,
    onOneTimeKeyUsed: () => manager.noteOneTimeKeyUsed(),
  });
  await manager.setup();

  // ---- to-device inbox: one message at a time, in arrival order ----
  const inbox: ToDeviceDispatchPayload[] = [];
  let draining: Promise<void> | null = null;
  let stopped = false;
  let lastAckedId = await olm.lastProcessed();
  let lastAckAt = 0;
  let ackTimer: ReturnType<typeof setTimeout> | null = null;

  function sendAck(): void {
    ackTimer = null;
    void olm.lastProcessed().then((processed) => {
      if (stopped || BigInt(processed) <= BigInt(lastAckedId)) {
        return;
      }
      lastAckedId = processed;
      lastAckAt = Date.now();
      transport.ackToDevice(processed, false);
    });
  }

  function scheduleAck(): void {
    if (ackTimer || stopped) {
      return;
    }
    const wait = Math.max(0, lastAckAt + ACK_INTERVAL_MS - Date.now());
    ackTimer = setTimeout(sendAck, wait);
  }

  function drain(): Promise<void> {
    draining ??= (async () => {
      while (inbox.length > 0 && !stopped) {
        await olm.handleToDevice(inbox.shift()!);
      }
      draining = null;
      scheduleAck();
    })();
    return draining;
  }

  /** Ask the server to send again every message after the last processed one. */
  async function resync(): Promise<void> {
    const processed = await olm.lastProcessed();
    lastAckedId = processed;
    lastAckAt = Date.now();
    transport.ackToDevice(processed, true);
  }

  function handleDispatch(dispatch: { t: string; d: unknown }): void {
    if (stopped) {
      return;
    }
    if (dispatch.t === "TO_DEVICE") {
      const parsed = toDeviceDispatchPayloadSchema.safeParse(dispatch.d);
      if (parsed.success) {
        inbox.push(parsed.data);
        void drain();
      }
    } else if (dispatch.t === "DEVICE_LIST_UPDATE") {
      const parsed = deviceListUpdatePayloadSchema.safeParse(dispatch.d);
      if (parsed.success) {
        void devices.markOutdated(parsed.data.userId);
      }
    } else if (dispatch.t === "READY" || dispatch.t === "RESUMED") {
      void resync();
      if (dispatch.t === "READY") {
        const parsed = readyPayloadSchema.safeParse(dispatch.d);
        if (parsed.success) {
          void manager
            .onKeyCounts(parsed.data)
            .catch((error: unknown) => log(`The one-time keys could not be topped up: ${String(error)}`));
        }
      }
    }
  }

  await resync();

  return {
    userId,
    deviceId,
    identityKeys: { curve25519: account.curve25519, ed25519: account.ed25519 },
    devices,
    handleDispatch,
    encryptToDevices: (targets, type, content) => olm.encryptToDevices(targets, type, content),
    async encryptToUsers(userIds, type, content) {
      const targets: DeviceRef[] = [];
      for (const target of userIds) {
        for (const device of await devices.getDevices(target)) {
          targets.push({ userId: device.userId, deviceId: device.deviceId });
        }
      }
      return olm.encryptToDevices(targets, type, content);
    },
    onToDevice: (handler) => olm.onToDevice(handler),
    sessionCount: () => olm.sessionCount(),
    changedMasterKeys: () => devices.changedMasterKeys(),
    onMasterKeyChanged(listener) {
      masterKeyListeners.add(listener);
      return () => {
        masterKeyListeners.delete(listener);
      };
    },
    async whenIdle() {
      while (draining) {
        await draining;
      }
      await olm.whenIdle();
      while (draining) {
        await draining;
      }
    },
    stop() {
      stopped = true;
      if (ackTimer) {
        clearTimeout(ackTimer);
      }
      inbox.length = 0;
      store.close();
    },
  };
}
