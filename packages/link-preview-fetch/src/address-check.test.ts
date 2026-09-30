// Tests for the address rules that the server and the Linux desktop app
// share: blocked addresses and the URL checks that need no DNS.
import { describe, expect, it } from "vitest";
import { checkUrl, isBlockedAddress, LinkPreviewError } from "./address-check.js";

describe("isBlockedAddress", () => {
  it("blocks private, loopback, link-local, multicast and unique local addresses", () => {
    for (const address of [
      "127.0.0.1",
      "127.255.255.254",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "192.0.2.5",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "fec0::1",
      "ff02::1",
      "2001:db8::1",
      "64:ff9b::a00:1",
      "2002::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const address of [
      "93.184.216.34",
      "1.1.1.1",
      "172.32.0.1",
      "100.128.0.1",
      "2606:4700:4700::1111",
      "::ffff:8.8.8.8",
    ]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it("blocks a value that is not an IP address", () => {
    expect(isBlockedAddress("example.com")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });

  it("allows only loopback in the test mode", () => {
    expect(isBlockedAddress("127.0.0.1", true)).toBe(false);
    expect(isBlockedAddress("::1", true)).toBe(false);
    expect(isBlockedAddress("10.0.0.1", true)).toBe(true);
    expect(isBlockedAddress("169.254.169.254", true)).toBe(true);
  });
});

function codeOf(url: string, testAllowLoopback = false): string | null {
  try {
    checkUrl(new URL(url), testAllowLoopback);
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(LinkPreviewError);
    return (error as LinkPreviewError).code;
  }
}

describe("checkUrl", () => {
  it("allows http and https on the default ports", () => {
    expect(codeOf("https://example.com/page")).toBeNull();
    expect(codeOf("http://example.com:80/")).toBeNull();
    expect(codeOf("https://example.com:443/")).toBeNull();
  });

  it("refuses other schemes, other ports and credentials", () => {
    for (const url of [
      "ftp://example.com/",
      "file:///etc/passwd",
      "https://example.com:8443/",
      "http://example.com:22/",
      "https://user:secret@example.com/",
    ]) {
      expect(codeOf(url), url).toBe("URL_NOT_ALLOWED");
    }
  });

  it("refuses literal private addresses, also in their short forms", () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://169.254.169.254/latest/meta-data",
      "http://2130706433/",
      "http://0x7f.1/",
    ]) {
      expect(codeOf(url), url).toBe("URL_NOT_ALLOWED");
    }
  });

  it("allows loopback on any port only in the test mode", () => {
    expect(codeOf("http://127.0.0.1:4310/", true)).toBeNull();
    expect(codeOf("http://10.0.0.1/", true)).toBe("URL_NOT_ALLOWED");
  });
});
