// The text form of a recovery key: the prefix bytes 0x8B 0x01, the 32 key
// bytes and one parity byte (the XOR of all bytes before it), in base58,
// in groups of 4 characters. This is the Matrix form. The parity byte
// finds a wrong character before the app downloads the backup. See
// docs/concepts/olm-megolm.md section 9.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PREFIX = [0x8b, 0x01];
const KEY_BYTES = 32;

function toBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) {
    value = value * 256n + BigInt(byte);
  }
  let text = "";
  while (value > 0n) {
    text = ALPHABET[Number(value % 58n)]! + text;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) {
      break;
    }
    text = `1${text}`;
  }
  return text;
}

function fromBase58(text: string): Uint8Array | null {
  let value = 0n;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) {
      return null;
    }
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value % 256n));
    value /= 256n;
  }
  for (const char of text) {
    if (char !== "1") {
      break;
    }
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}

/** The recovery key as text for the user, for example "EsT1 2abc ...". */
export function encodeRecoveryKey(key: Uint8Array): string {
  if (key.length !== KEY_BYTES) {
    throw new Error("A recovery key has 32 bytes.");
  }
  const bytes = new Uint8Array(PREFIX.length + KEY_BYTES + 1);
  bytes.set(PREFIX);
  bytes.set(key, PREFIX.length);
  bytes[bytes.length - 1] = bytes.subarray(0, -1).reduce((parity, byte) => parity ^ byte, 0);
  return toBase58(bytes).match(/.{1,4}/g)!.join(" ");
}

/** The 32 key bytes of a recovery key text, or null when the text is not a valid recovery key. Spaces do not count. */
export function decodeRecoveryKey(text: string): Uint8Array | null {
  const bytes = fromBase58(text.replace(/\s+/g, ""));
  if (!bytes || bytes.length !== PREFIX.length + KEY_BYTES + 1 || bytes[0] !== PREFIX[0] || bytes[1] !== PREFIX[1]) {
    return null;
  }
  if (bytes.reduce((parity, byte) => parity ^ byte, 0) !== 0) {
    return null;
  }
  return bytes.slice(PREFIX.length, PREFIX.length + KEY_BYTES);
}
