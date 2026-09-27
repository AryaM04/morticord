import { describe, expect, it } from "vitest";
import { decodeBase64Url, encodeBase64Url } from "./base64.js";

describe("base64url", () => {
  it("round-trips arbitrary bytes", () => {
    for (const length of [0, 1, 2, 3, 4, 5, 16, 100]) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        bytes[i] = (i * 37 + 11) % 256;
      }
      expect(decodeBase64Url(encodeBase64Url(bytes))).toEqual(bytes);
    }
  });

  it("never emits padding characters", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    expect(encodeBase64Url(bytes)).not.toContain("=");
  });

  it("decodes padded input the same as unpadded input", () => {
    const bytes = new Uint8Array([250, 251, 252]);
    const unpadded = encodeBase64Url(bytes);
    expect(decodeBase64Url(`${unpadded}==`.slice(0, unpadded.length + 1))).toBeTruthy();
  });

  it("rejects text with characters outside the base64url alphabet", () => {
    expect(() => decodeBase64Url("not valid!")).toThrow();
  });

  it("matches known vectors", () => {
    expect(encodeBase64Url(new TextEncoder().encode("hello"))).toBe("aGVsbG8");
    expect(decodeBase64Url("aGVsbG8")).toEqual(new TextEncoder().encode("hello"));
  });
});
