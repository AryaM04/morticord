// Unit tests for the User-Agent to device-name summary.
import { expect, it } from "vitest";
import { summarizeUserAgent } from "./device-name.js";

it("returns a fallback name when there is no User-Agent header", () => {
  expect(summarizeUserAgent(undefined)).toBe("Unknown device");
});

it("names a common desktop browser and OS pair", () => {
  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  expect(summarizeUserAgent(ua)).toBe("Chrome on Windows");
});

it("names Firefox on Linux", () => {
  const ua = "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/119.0";
  expect(summarizeUserAgent(ua)).toBe("Firefox on Linux");
});

it("names Safari on an iPhone", () => {
  const ua =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  expect(summarizeUserAgent(ua)).toBe("Safari on iPhone");
});

it("falls back to a generic name for an unrecognized header", () => {
  expect(summarizeUserAgent("SomeWeirdClient/1.0")).toBe("Unknown device");
});

it("never returns more than 64 characters", () => {
  const ua = "Chrome/1.0 ".repeat(50);
  expect(summarizeUserAgent(ua).length).toBeLessThanOrEqual(64);
});

it("strips control characters from a hostile header", () => {
  const ua = "Chrome/120\x00\x1b[31m on Windows";
  const result = summarizeUserAgent(ua);
  for (let i = 0; i < result.length; i++) {
    expect(result.charCodeAt(i)).toBeGreaterThanOrEqual(0x20);
  }
});
