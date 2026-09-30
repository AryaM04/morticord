// The secure store of the Linux app: Electron safeStorage. It keeps only
// small values: the session tokens and the key that wraps the crypto data
// (the pickle key). Each value is encrypted with a key from the system key
// ring (GNOME Keyring or KWallet), and the file holds only ciphertext.
//
// Without a key ring, Electron falls back to the "basic_text" backend,
// which uses a fixed key: that is plain text in practice. The app refuses
// to keep secrets then, and the web app shows the fix.
import type { SafeStorage } from "electron";
import { JsonFile } from "./json-file.js";

type Storage = Pick<SafeStorage, "isEncryptionAvailable" | "encryptString" | "decryptString"> &
  Partial<Pick<SafeStorage, "getSelectedStorageBackend">>;

export const NO_KEY_RING_REASON =
  "The app did not find a system key ring (Secret Service), so it cannot encrypt your sign-in and your encryption key. The app does not keep them as plain text.";

/** Null when the store can keep secrets safely, else the reason. Call after the app is ready. */
export function secureStoreUnavailableReason(storage: Storage, platform: NodeJS.Platform): string | null {
  if (!storage.isEncryptionAvailable()) {
    return NO_KEY_RING_REASON;
  }
  if (platform === "linux") {
    const backend = storage.getSelectedStorageBackend?.() ?? "unknown";
    if (backend === "basic_text" || backend === "unknown") {
      return NO_KEY_RING_REASON;
    }
  }
  return null;
}

export class SecureStore {
  private readonly file: JsonFile<Record<string, string>>;
  private entries: Record<string, string> | null = null;

  constructor(
    path: string,
    private readonly storage: Storage,
    private readonly unavailableReason: string | null,
  ) {
    this.file = new JsonFile(path);
  }

  private load(): Record<string, string> {
    if (!this.entries) {
      const stored = this.file.read() ?? {};
      this.entries = Object.fromEntries(
        Object.entries(stored).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      );
    }
    return this.entries;
  }

  private check(): void {
    if (this.unavailableReason) {
      throw new Error(this.unavailableReason);
    }
  }

  async get(key: string): Promise<string | null> {
    this.check();
    const sealed = this.load()[key];
    if (sealed === undefined) {
      return null;
    }
    try {
      return this.storage.decryptString(Buffer.from(sealed, "base64"));
    } catch {
      // The key ring key changed (a new key ring, for example). The value is lost; the user signs in again.
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    this.check();
    const entries = this.load();
    entries[key] = this.storage.encryptString(value).toString("base64");
    await this.file.write(entries);
  }

  async delete(key: string): Promise<void> {
    this.check();
    const entries = this.load();
    if (key in entries) {
      delete entries[key];
      await this.file.write(entries);
    }
  }
}
