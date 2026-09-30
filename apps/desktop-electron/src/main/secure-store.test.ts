// Tests for the secure store: the key ring check, and a round trip through
// the file with a fake safeStorage. The file must hold no plain text.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NO_KEY_RING_REASON, SecureStore, secureStoreUnavailableReason } from "./secure-store.js";

/** A fake safeStorage: it reverses the bytes and adds a prefix. Not safe, but not plain text. */
function fakeStorage(backend: string, available = true) {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend as "gnome_libsecret",
    encryptString: (value: string) => Buffer.concat([Buffer.from("v11"), Buffer.from(value).reverse()]),
    decryptString: (data: Buffer) => {
      if (data.subarray(0, 3).toString() !== "v11") throw new Error("bad data");
      return Buffer.from(data.subarray(3)).reverse().toString();
    },
  };
}

describe("secureStoreUnavailableReason", () => {
  it("accepts a real key ring", () => {
    expect(secureStoreUnavailableReason(fakeStorage("gnome_libsecret"), "linux")).toBeNull();
    expect(secureStoreUnavailableReason(fakeStorage("kwallet6"), "linux")).toBeNull();
  });

  it("refuses the basic_text backend and no encryption", () => {
    expect(secureStoreUnavailableReason(fakeStorage("basic_text"), "linux")).toBe(NO_KEY_RING_REASON);
    expect(secureStoreUnavailableReason(fakeStorage("unknown"), "linux")).toBe(NO_KEY_RING_REASON);
    expect(secureStoreUnavailableReason(fakeStorage("gnome_libsecret", false), "linux")).toBe(NO_KEY_RING_REASON);
  });
});

describe("SecureStore", () => {
  it("keeps, reads and removes values, and writes only ciphertext", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "secure-")), "secure-store.json");
    const store = new SecureStore(path, fakeStorage("gnome_libsecret"), null);
    expect(await store.get("session")).toBeNull();
    await store.set("session", '{"accessToken":"secret-token"}');
    expect(await store.get("session")).toBe('{"accessToken":"secret-token"}');
    expect(readFileSync(path, "utf8")).not.toContain("secret-token");

    // A new store reads the same file.
    const again = new SecureStore(path, fakeStorage("gnome_libsecret"), null);
    expect(await again.get("session")).toBe('{"accessToken":"secret-token"}');
    await again.delete("session");
    expect(await new SecureStore(path, fakeStorage("gnome_libsecret"), null).get("session")).toBeNull();
  });

  it("refuses every call without a key ring", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "secure-")), "secure-store.json");
    const store = new SecureStore(path, fakeStorage("basic_text"), NO_KEY_RING_REASON);
    await expect(store.set("session", "x")).rejects.toThrow(NO_KEY_RING_REASON);
    await expect(store.get("session")).rejects.toThrow(NO_KEY_RING_REASON);
  });

  it("gives null for a value that does not decrypt", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "secure-")), "secure-store.json");
    await new SecureStore(path, fakeStorage("gnome_libsecret"), null).set("session", "x");
    const other = { ...fakeStorage("gnome_libsecret"), decryptString: () => { throw new Error("new key"); } };
    expect(await new SecureStore(path, other, null).get("session")).toBeNull();
  });
});
