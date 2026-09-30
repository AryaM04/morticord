// The address rules of a link preview fetch. The server (for the web
// client) and the Linux desktop app (Electron) fetch a page that a user
// names, so this code must not let a user reach a private network (SSRF).
// Both use this one module, so the rules stay the same. The Tauri app has
// the same rules in Rust (apps/desktop-tauri/src-tauri/src/link_preview.rs).
import { BlockList, isIP } from "node:net";

/** `code` is a stable reason for the client. The message never holds the URL. */
export class LinkPreviewError extends Error {
  constructor(
    readonly code: "URL_NOT_ALLOWED" | "NO_PREVIEW",
    message: string,
  ) {
    super(message);
    this.name = "LinkPreviewError";
  }
}

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarks
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved and broadcast
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  // An IPv4-mapped address (::ffff:a.b.c.d) is checked against the IPv4 rules above.
  ["64:ff9b::", 96], // NAT64
  ["100::", 64], // discard
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (old)
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

const loopback = new BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addAddress("::1", "ipv6");

/** True when the fetch must not connect to this address. A value that is not an IP address is blocked. */
export function isBlockedAddress(address: string, testAllowLoopback = false): boolean {
  const family = isIP(address);
  if (family === 0) {
    return true;
  }
  const type = family === 4 ? "ipv4" : "ipv6";
  if (testAllowLoopback && loopback.check(address, type)) {
    return false;
  }
  return blocked.check(address, type);
}

/** The host of a URL without the brackets of an IPv6 literal. */
function bareHost(url: URL): string {
  return url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
}

/** Check the parts of a URL that do not need DNS. Throws `URL_NOT_ALLOWED`. */
export function checkUrl(url: URL, testAllowLoopback = false): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new LinkPreviewError("URL_NOT_ALLOWED", "Only http and https links can have a preview.");
  }
  if (url.username || url.password) {
    throw new LinkPreviewError(
      "URL_NOT_ALLOWED",
      "A link with a user name or a password cannot have a preview.",
    );
  }
  if (url.port !== "" && url.port !== "80" && url.port !== "443" && !testAllowLoopback) {
    throw new LinkPreviewError(
      "URL_NOT_ALLOWED",
      "Only links on port 80 or 443 can have a preview.",
    );
  }
  const host = bareHost(url);
  if (isIP(host) !== 0 && isBlockedAddress(host, testAllowLoopback)) {
    throw new LinkPreviewError("URL_NOT_ALLOWED", "This link goes to a private network address.");
  }
}
