// Base64url encode and decode, written in plain JavaScript.
// This package has no Node APIs and no DOM APIs, so it cannot use `Buffer`
// or `atob`/`btoa`. Every client and the server share this one code path.

const BASE64URL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const BASE64URL_LOOKUP: ReadonlyMap<string, number> = new Map(
  BASE64URL_CHARS.split("").map((char, index) => [char, index]),
);

function charAt(sixBits: number): string {
  return BASE64URL_CHARS.charAt(sixBits);
}

/** Encode raw bytes as base64url text, with no padding. */
export function encodeBase64Url(bytes: Uint8Array): string {
  let result = "";
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const chunk = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    result +=
      charAt((chunk >> 18) & 63) + charAt((chunk >> 12) & 63) + charAt((chunk >> 6) & 63) + charAt(chunk & 63);
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const chunk = bytes[i]! << 16;
    result += charAt((chunk >> 18) & 63) + charAt((chunk >> 12) & 63);
  } else if (remaining === 2) {
    const chunk = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    result += charAt((chunk >> 18) & 63) + charAt((chunk >> 12) & 63) + charAt((chunk >> 6) & 63);
  }
  return result;
}

/** Decode base64url text (with or without `=` padding) back to raw bytes. */
export function decodeBase64Url(text: string): Uint8Array {
  const clean = text.replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = BASE64URL_LOOKUP.get(char);
    if (value === undefined) {
      throw new Error("This text is not valid base64url.");
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}
