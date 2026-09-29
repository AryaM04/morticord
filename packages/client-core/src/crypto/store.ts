// The crypto store: one IndexedDB database for each user and device. It
// holds pickles (encrypted by vodozemac with the pickle key), the device
// list cache and small state values. See docs/concepts/olm-megolm.md
// section 7.

/** One Olm session with one peer device. `peerKey` is the Curve25519 key of the peer. */
export interface SessionRecord {
  peerKey: string;
  sessionId: string;
  pickle: string;
  createdAt: number;
  /** When a message from the peer last decrypted with this session, or 0. */
  lastReceivedAt: number;
}

/** One device of a user, after the client verified its signature. */
export interface DeviceRecord {
  userId: string;
  deviceId: string;
  curve25519: string;
  ed25519: string;
  /** True when the trusted master key of the user signed this device. */
  ownerVerified: boolean;
}

/** What the client knows about the device list of one user. */
export interface UserRecord {
  userId: string;
  /** Tracked users get DEVICE_LIST_UPDATE handling and are kept fresh. */
  tracked: boolean;
  /** True when the cached device list may be old. */
  outdated: boolean;
  /** The master key trusted on first use, or null. */
  masterKey: string | null;
  /** A different master key that the server now shows. The UI must warn. */
  changedMasterKey: string | null;
}

/** One write batch. The store applies it in one transaction. */
export interface StoreChanges {
  values?: Record<string, unknown>;
  sessions?: SessionRecord[];
  deleteSessions?: Array<[peerKey: string, sessionId: string]>;
}

export interface CryptoStore {
  getValue<T>(key: string): Promise<T | undefined>;
  getSessions(peerKey: string): Promise<SessionRecord[]>;
  countSessions(): Promise<number>;
  getUser(userId: string): Promise<UserRecord | undefined>;
  getUsers(): Promise<UserRecord[]>;
  putUser(user: UserRecord): Promise<void>;
  getDevices(userId: string): Promise<DeviceRecord[]>;
  /** Replace the device list of one user and its user record, in one transaction. */
  replaceDevices(user: UserRecord, devices: DeviceRecord[]): Promise<void>;
  commit(changes: StoreChanges): Promise<void>;
  close(): void;
}

const VERSION = 1;
const VALUES = "values";
const SESSIONS = "sessions";
const USERS = "users";
const DEVICES = "devices";

function done(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("An IndexedDB request failed."));
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("An IndexedDB transaction failed."));
    tx.onabort = () => reject(tx.error ?? new Error("An IndexedDB transaction was stopped."));
  });
}

function open(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(VALUES);
      db.createObjectStore(SESSIONS, { keyPath: ["peerKey", "sessionId"] }).createIndex("peerKey", "peerKey");
      db.createObjectStore(USERS, { keyPath: "userId" });
      db.createObjectStore(DEVICES, { keyPath: ["userId", "deviceId"] }).createIndex("userId", "userId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The crypto store could not open."));
  });
}

/** The database name of the crypto store of one user and device. */
export function cryptoStoreName(userId: string, deviceId: string): string {
  return `crypto:${userId}:${deviceId}`;
}

/** Open the IndexedDB crypto store. Tests pass their own `factory`. */
export async function openCryptoStore(name: string, factory: IDBFactory = indexedDB): Promise<CryptoStore> {
  const db = await open(factory, name);

  async function read<T>(storeName: string, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    const tx = db.transaction(storeName, "readonly");
    return (await done(run(tx.objectStore(storeName)))) as T;
  }

  return {
    getValue: (key) => read(VALUES, (store) => store.get(key)),

    getSessions: (peerKey) => read(SESSIONS, (store) => store.index("peerKey").getAll(peerKey)),

    countSessions: () => read(SESSIONS, (store) => store.count()),

    getUser: (userId) => read(USERS, (store) => store.get(userId)),

    getUsers: () => read(USERS, (store) => store.getAll()),

    async putUser(user) {
      const tx = db.transaction(USERS, "readwrite");
      tx.objectStore(USERS).put(user);
      await finished(tx);
    },

    getDevices: (userId) => read(DEVICES, (store) => store.index("userId").getAll(userId)),

    async replaceDevices(user, devices) {
      const tx = db.transaction([USERS, DEVICES], "readwrite");
      const deviceStore = tx.objectStore(DEVICES);
      const oldKeys = (await done(deviceStore.index("userId").getAllKeys(user.userId))) as IDBValidKey[];
      for (const key of oldKeys) {
        deviceStore.delete(key);
      }
      for (const device of devices) {
        deviceStore.put(device);
      }
      tx.objectStore(USERS).put(user);
      await finished(tx);
    },

    async commit(changes) {
      const tx = db.transaction([VALUES, SESSIONS], "readwrite");
      for (const [key, value] of Object.entries(changes.values ?? {})) {
        tx.objectStore(VALUES).put(value, key);
      }
      for (const session of changes.sessions ?? []) {
        tx.objectStore(SESSIONS).put(session);
      }
      for (const key of changes.deleteSessions ?? []) {
        tx.objectStore(SESSIONS).delete(key);
      }
      await finished(tx);
    },

    close() {
      db.close();
    },
  };
}
