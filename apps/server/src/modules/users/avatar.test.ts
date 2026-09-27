// Tests for the image magic-byte check.
import { describe, expect, it } from "vitest";
import { detectImageContentType } from "./avatar.js";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP_HEADER = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP", "ascii"),
]);

describe("detectImageContentType", () => {
  it("detects a PNG file from its magic bytes", () => {
    expect(detectImageContentType(PNG_HEADER)).toBe("image/png");
  });

  it("detects a JPEG file from its magic bytes", () => {
    expect(detectImageContentType(JPEG_HEADER)).toBe("image/jpeg");
  });

  it("detects a WEBP file from its magic bytes", () => {
    expect(detectImageContentType(WEBP_HEADER)).toBe("image/webp");
  });

  it("returns null for a text file renamed to look like an image", () => {
    expect(detectImageContentType(Buffer.from("not really an image", "utf8"))).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(detectImageContentType(Buffer.alloc(0))).toBeNull();
  });

  it("returns null for a PNG-like header with the wrong last byte", () => {
    const almostPng = Buffer.from(PNG_HEADER);
    almostPng[7] = 0x00;
    expect(detectImageContentType(almostPng)).toBeNull();
  });
});
