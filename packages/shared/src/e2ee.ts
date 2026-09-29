// Canonical JSON and the signed objects of the E2EE protocol. The server
// and the clients build the same text here, so a signature made on one
// side verifies on the other. See docs/concepts/olm-megolm.md section 2.

/**
 * Canonical JSON: sorted object keys (by UTF-16 code unit), no white
 * space, and only strings, booleans, null, safe integers, arrays and
 * objects. Any other value throws, so a caller cannot sign a value that
 * two sides encode in different ways.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("Canonical JSON accepts only safe integers.");
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error(`Canonical JSON does not accept the type "${typeof value}".`);
}

/** The text that the device Ed25519 key (and the master key) signs for the identity keys of a device. */
export function deviceKeysSignedText(userId: string, deviceId: string, curve25519: string, ed25519: string): string {
  return canonicalJson({ type: "device_keys", userId, deviceId, curve25519, ed25519 });
}

/** The text that the device Ed25519 key signs for one one-time key or the fallback key. */
export function oneTimeKeySignedText(
  kind: "one_time_key" | "fallback_key",
  userId: string,
  deviceId: string,
  keyId: string,
  key: string,
): string {
  return canonicalJson({ type: kind, userId, deviceId, keyId, key });
}

/** The text that a device Ed25519 key signs to vouch for the master key of its user. */
export function masterKeySignedText(userId: string, publicKey: string): string {
  return canonicalJson({ type: "master_key", userId, publicKey });
}
