// A platform gives client-core the one thing it needs from the host: a
// secure place to keep the session. The web app uses IndexedDB. A
// desktop shell (M7) will supply its own OS key store here.

/** A small secure key-value store. Values are text (JSON, in practice). */
export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** The host services that client-core needs. */
export interface Platform {
  secureStore: SecureStore;
}

const DB_NAME = "discord-clone-secure-store";
const DB_VERSION = 1;
const STORE_NAME = "kv";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the local store."));
  });
}

/** A tiny IndexedDB-backed secure store for the web platform. */
function createIndexedDbSecureStore(): SecureStore {
  let dbPromise: Promise<IDBDatabase> | null = null;
  function getDb(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = openDatabase();
    }
    return dbPromise;
  }

  return {
    async get(key: string): Promise<string | null> {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).get(key);
        request.onsuccess = () => resolve((request.result as string | undefined) ?? null);
        request.onerror = () => reject(request.error ?? new Error("Could not read the local store."));
      });
    },

    async set(key: string, value: string): Promise<void> {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Could not write to the local store."));
      });
    },

    async delete(key: string): Promise<void> {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Could not write to the local store."));
      });
    },
  };
}

/** The platform for the web app: a browser tab, backed by IndexedDB. */
export const webPlatform: Platform = {
  secureStore: createIndexedDbSecureStore(),
};
