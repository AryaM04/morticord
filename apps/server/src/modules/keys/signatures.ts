// Ed25519 signature checks with node:crypto. The server rejects keys with
// a bad signature, so a client bug or an attacker cannot store garbage.
// Clients still verify every signature themselves: they do not trust the
// server for this. See docs/concepts/olm-megolm.md section 3.
import { createPublicKey, verify } from "node:crypto";

/** True when `signature` (unpadded base64) is a valid Ed25519 signature of `message` by `publicKey`. */
export function verifyEd25519(publicKey: string, message: string, signature: string): boolean {
  try {
    const rawKey = Buffer.from(publicKey, "base64");
    const rawSignature = Buffer.from(signature, "base64");
    if (rawKey.length !== 32 || rawSignature.length !== 64) {
      return false;
    }
    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: rawKey.toString("base64url") },
      format: "jwk",
    });
    return verify(null, Buffer.from(message, "utf8"), key, rawSignature);
  } catch {
    return false;
  }
}
