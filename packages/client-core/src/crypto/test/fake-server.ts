// A fake key server and to-device queue for the crypto tests. It keeps
// the same rules as the real server (atomic claim, fallback key, queue
// with acknowledgements), but in memory, and every user sees every user.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { IDBFactory } from "fake-indexeddb";
import type {
  ClaimedKey,
  QueriedUser,
  ToDeviceDispatchPayload,
  UploadKeysRequest,
  UploadKeysResponse,
} from "@discord-clone/shared";
import { initSync } from "@discord-clone/crypto-wasm";
import type { SecureStore } from "../../platform.js";
import { startCrypto, type CryptoHandle, type CryptoTransport } from "../index.js";

/** Load the WASM file from disk, as the browser loads it from a URL. */
export function initWasmForTests(): void {
  const require = createRequire(import.meta.url);
  initSync({ module: readFileSync(require.resolve("@discord-clone/crypto-wasm/pkg/crypto_wasm_bg.wasm")) });
}

interface FakeDevice {
  userId: string;
  deviceId: string;
  keys?: { curve25519: string; ed25519: string; signature: string };
  masterSignature: string | null;
  oneTimeKeys: Map<string, { key: string; signature: string }>;
  fallback?: { keyId: string; key: string; signature: string; used: boolean };
}

interface QueuedMessage {
  id: bigint;
  recipient: string;
  payload: ToDeviceDispatchPayload;
}

export function memorySecureStore(): SecureStore {
  const values = new Map<string, string>();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    delete: async (key) => {
      values.delete(key);
    },
  };
}

/** One simulated client device: its own IndexedDB and secure store, which survive a restart. */
export interface TestClient {
  userId: string;
  deviceId: string;
  indexedDb: IDBFactory;
  secureStore: SecureStore;
  handle: CryptoHandle | null;
  received: Array<{ type: string; content: Record<string, unknown>; from: string }>;
}

const key = (userId: string, deviceId: string) => `${userId}:${deviceId}`;

export class FakeServer {
  readonly devices = new Map<string, FakeDevice>();
  readonly masters = new Map<string, { publicKey: string; deviceId: string; deviceSignature: string }>();
  readonly queue: QueuedMessage[] = [];
  private readonly online = new Map<string, CryptoHandle>();
  private nextId = 1n;
  /** Change a TO_DEVICE dispatch before it goes out. Tests use it to act as a malicious server. */
  tamper: ((payload: ToDeviceDispatchPayload) => ToDeviceDispatchPayload) | null = null;

  device(userId: string, deviceId: string): FakeDevice {
    let device = this.devices.get(key(userId, deviceId));
    if (!device) {
      device = { userId, deviceId, masterSignature: null, oneTimeKeys: new Map() };
      this.devices.set(key(userId, deviceId), device);
    }
    return device;
  }

  counts(device: FakeDevice): UploadKeysResponse {
    return {
      oneTimeKeyCount: device.oneTimeKeys.size,
      needsFallbackKey: !device.fallback || device.fallback.used,
    };
  }

  transportFor(userId: string, deviceId: string): CryptoTransport {
    return {
      uploadKeys: async (body: UploadKeysRequest) => {
        const device = this.device(userId, deviceId);
        if (body.deviceKeys) {
          device.keys ??= body.deviceKeys;
        }
        for (const [keyId, value] of Object.entries(body.oneTimeKeys ?? {})) {
          device.oneTimeKeys.set(keyId, value);
        }
        if (body.fallbackKey && body.fallbackKey.keyId !== device.fallback?.keyId) {
          device.fallback = { ...body.fallbackKey, used: false };
        }
        if (body.masterSignature) {
          device.masterSignature = body.masterSignature;
        }
        return this.counts(device);
      },
      putMasterKey: async (body) => {
        const existing = this.masters.get(userId);
        if (existing && existing.publicKey !== body.publicKey) {
          throw Object.assign(new Error("exists"), { code: "MASTER_KEY_EXISTS" });
        }
        this.masters.set(userId, { publicKey: body.publicKey, deviceId, deviceSignature: body.deviceSignature });
        this.device(userId, deviceId).masterSignature = body.masterSignature;
      },
      queryKeys: async (userIds) => ({ users: userIds.map((id) => this.queried(id)) }),
      claimKeys: async (targets) => {
        const keys: ClaimedKey[] = [];
        for (const target of targets) {
          const device = this.devices.get(key(target.userId, target.deviceId));
          if (!device?.keys) {
            continue;
          }
          const first = device.oneTimeKeys.entries().next();
          if (!first.done) {
            const [keyId, value] = first.value;
            device.oneTimeKeys.delete(keyId);
            keys.push({ ...target, keyId, key: value.key, signature: value.signature, fallback: false });
          } else if (device.fallback) {
            device.fallback.used = true;
            const { keyId, key: fallbackKey, signature } = device.fallback;
            keys.push({ ...target, keyId, key: fallbackKey, signature, fallback: true });
          }
        }
        return { keys };
      },
      sendToDevice: async (messages) => {
        const skipped = [];
        for (const message of messages) {
          const recipient = key(message.userId, message.deviceId);
          if (!this.devices.get(recipient)?.keys) {
            skipped.push({ userId: message.userId, deviceId: message.deviceId });
            continue;
          }
          const id = this.nextId++;
          const payload: ToDeviceDispatchPayload = {
            id: id.toString(),
            senderUserId: userId,
            senderDeviceId: deviceId,
            type: message.type,
            ciphertext: message.ciphertext,
            createdAt: new Date().toISOString(),
          };
          this.queue.push({ id, recipient, payload });
          this.online.get(recipient)?.handleDispatch({ t: "TO_DEVICE", d: this.tamper ? this.tamper(payload) : payload });
        }
        return { skipped };
      },
      ackToDevice: (upToId, resync) => {
        const recipient = key(userId, deviceId);
        const limit = BigInt(upToId);
        for (let i = this.queue.length - 1; i >= 0; i -= 1) {
          if (this.queue[i]!.recipient === recipient && this.queue[i]!.id <= limit) {
            this.queue.splice(i, 1);
          }
        }
        if (resync) {
          this.deliverPending(recipient);
        }
      },
    };
  }

  /** Put a raw message in the queue, as if `sender` sent it. For forged-message tests. */
  inject(sender: { userId: string; deviceId: string }, recipient: { userId: string; deviceId: string }, ciphertext: string): void {
    const id = this.nextId++;
    const payload: ToDeviceDispatchPayload = {
      id: id.toString(),
      senderUserId: sender.userId,
      senderDeviceId: sender.deviceId,
      type: "olm.v1",
      ciphertext,
      createdAt: new Date().toISOString(),
    };
    const target = key(recipient.userId, recipient.deviceId);
    this.queue.push({ id, recipient: target, payload });
    this.online.get(target)?.handleDispatch({ t: "TO_DEVICE", d: payload });
  }

  queuedFor(userId: string, deviceId: string): number {
    return this.queue.filter((entry) => entry.recipient === key(userId, deviceId)).length;
  }

  /** Start (or restart) the crypto layer of a client and mark it online. */
  async start(client: TestClient): Promise<CryptoHandle> {
    const recipient = key(client.userId, client.deviceId);
    const handle = await startCrypto({
      userId: client.userId,
      deviceId: client.deviceId,
      transport: this.transportFor(client.userId, client.deviceId),
      secureStore: client.secureStore,
      indexedDb: client.indexedDb,
    });
    handle.onToDevice((event) => {
      client.received.push({ type: event.type, content: event.content, from: key(event.sender.userId, event.sender.deviceId) });
    });
    client.handle = handle;
    this.online.set(recipient, handle);
    this.deliverPending(recipient);
    return handle;
  }

  stop(client: TestClient): void {
    this.online.delete(key(client.userId, client.deviceId));
    client.handle?.stop();
    client.handle = null;
  }

  private deliverPending(recipient: string): void {
    const handle = this.online.get(recipient);
    for (const entry of this.queue.filter((item) => item.recipient === recipient)) {
      handle?.handleDispatch({ t: "TO_DEVICE", d: entry.payload });
    }
  }

  private queried(userId: string): QueriedUser {
    const master = this.masters.get(userId);
    return {
      userId,
      masterKey: master ?? null,
      devices: [...this.devices.values()]
        .filter((device) => device.userId === userId && device.keys)
        .map((device) => ({ deviceId: device.deviceId, ...device.keys!, masterSignature: device.masterSignature })),
    };
  }
}

export function newClient(userId: string, deviceId: string): TestClient {
  return { userId, deviceId, indexedDb: new IDBFactory(), secureStore: memorySecureStore(), handle: null, received: [] };
}
