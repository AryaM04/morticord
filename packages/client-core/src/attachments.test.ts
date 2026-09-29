import { describe, expect, it } from "vitest";
import {
  AttachmentIntegrityError,
  SizedLruCache,
  decryptFile,
  encryptFile,
  formatFileSize,
  isInlineImage,
  thumbnailSize,
} from "./attachments.js";

describe("attachment crypto", () => {
  it("encrypts and decrypts a file, with a new key and IV each time", async () => {
    const plaintext = crypto.getRandomValues(new Uint8Array(5000));
    const first = await encryptFile(plaintext);
    const second = await encryptFile(plaintext);
    expect(first.ciphertext).not.toEqual(plaintext);
    expect(first.ciphertext.length).toBe(plaintext.length + 16);
    expect(first.secrets.key).not.toBe(second.secrets.key);
    expect(first.secrets.iv).not.toBe(second.secrets.iv);
    expect(await decryptFile(first.ciphertext, first.secrets)).toEqual(plaintext);
  });

  it("rejects a ciphertext that does not match the SHA-256, before it decrypts", async () => {
    const { ciphertext, secrets } = await encryptFile(new TextEncoder().encode("secret file"));
    const changed = ciphertext.slice();
    changed[0] = changed[0]! ^ 1;
    await expect(decryptFile(changed, secrets)).rejects.toBeInstanceOf(AttachmentIntegrityError);

    // A wrong key with the right hash fails in AES-GCM, not in the hash check.
    const other = await encryptFile(new Uint8Array(4));
    await expect(decryptFile(ciphertext, { ...secrets, key: other.secrets.key })).rejects.not.toBeInstanceOf(
      AttachmentIntegrityError,
    );
  });
});

describe("attachment helpers", () => {
  it("fits a thumbnail in 320 px and never makes it larger", () => {
    expect(thumbnailSize(1920, 1080)).toEqual({ width: 320, height: 180 });
    expect(thumbnailSize(1000, 4000)).toEqual({ width: 80, height: 320 });
    expect(thumbnailSize(100, 50)).toEqual({ width: 100, height: 50 });
    expect(thumbnailSize(5000, 1)).toEqual({ width: 320, height: 1 });
  });

  it("shows only safe image types inline, never SVG", () => {
    expect(isInlineImage("image/png")).toBe(true);
    expect(isInlineImage("image/webp")).toBe(true);
    expect(isInlineImage("image/svg+xml")).toBe(false);
    expect(isInlineImage("text/html")).toBe(false);
  });

  it("formats sizes", () => {
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(25 * 1024 * 1024)).toBe("25 MB");
  });

  it("keeps the total size of the cache under the limit and evicts the least recently used entry", () => {
    const evicted: string[] = [];
    const cache = new SizedLruCache<string>(100, (value) => evicted.push(value));
    cache.set("a", "A", 40);
    cache.set("b", "B", 40);
    expect(cache.get("a")).toBe("A");
    cache.set("c", "C", 40);
    expect(evicted).toEqual(["B"]);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.size).toBe(80);
    cache.set("big", "BIG", 200);
    expect(evicted).toEqual(["B", "BIG"]);
    cache.clear();
    expect(evicted).toEqual(["B", "BIG", "A", "C"]);
    expect(cache.size).toBe(0);
  });
});
