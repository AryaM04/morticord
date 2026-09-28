// Tests for the pure SDP edit in sdp.ts: opus-only SDP, an SDP with an
// existing opus fmtp line, SDP with video and audio (video untouched),
// SDP with no existing fmtp line, and CRLF handling.
import { describe, expect, it } from "vitest";
import { preferOpusFec } from "./sdp.js";

const OPUS_ONLY_LF = [
  "v=0",
  "o=- 1 1 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "c=IN IP4 0.0.0.0",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10",
  "",
].join("\n");

describe("preferOpusFec", () => {
  it("adds fec, dtx and mono params to an existing opus fmtp line", () => {
    const result = preferOpusFec(OPUS_ONLY_LF);
    const fmtpLine = result.split("\n").find((line) => line.startsWith("a=fmtp:111"));
    expect(fmtpLine).toBeDefined();
    expect(fmtpLine).toContain("minptime=10");
    expect(fmtpLine).toContain("useinbandfec=1");
    expect(fmtpLine).toContain("usedtx=1");
    expect(fmtpLine).toContain("stereo=0");
  });

  it("does not duplicate a param already present with a different value", () => {
    const sdp = [
      "v=0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=rtpmap:111 opus/48000/2",
      "a=fmtp:111 minptime=10;useinbandfec=0;stereo=1",
      "",
    ].join("\n");
    const result = preferOpusFec(sdp);
    const fmtpLine = result.split("\n").find((line) => line.startsWith("a=fmtp:111"))!;
    expect(fmtpLine.match(/useinbandfec=/g)).toHaveLength(1);
    expect(fmtpLine).toContain("useinbandfec=1");
    expect(fmtpLine).toContain("stereo=0");
    expect(fmtpLine.match(/stereo=/g)).toHaveLength(1);
  });

  it("adds an fmtp line when opus has none yet", () => {
    const sdp = ["v=0", "m=audio 9 UDP/TLS/RTP/SAVPF 111", "a=rtpmap:111 opus/48000/2", ""].join("\n");
    const result = preferOpusFec(sdp);
    const lines = result.split("\n");
    const rtpmapIndex = lines.findIndex((line) => line.startsWith("a=rtpmap:111"));
    expect(lines[rtpmapIndex + 1]).toBe("a=fmtp:111 useinbandfec=1;usedtx=1;stereo=0");
  });

  it("edits only the audio section's opus line when video is also present", () => {
    const sdp = [
      "v=0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=rtpmap:111 opus/48000/2",
      "a=fmtp:111 minptime=10",
      "m=video 9 UDP/TLS/RTP/SAVPF 96",
      "a=rtpmap:96 VP8/90000",
      "a=fmtp:96 max-fs=12288",
      "",
    ].join("\n");
    const result = preferOpusFec(sdp);
    const lines = result.split("\n");
    expect(lines.find((line) => line.startsWith("a=fmtp:96"))).toBe("a=fmtp:96 max-fs=12288");
    expect(lines.find((line) => line.startsWith("a=fmtp:111"))).toContain("useinbandfec=1");
  });

  it("leaves other codecs' fmtp lines in the audio section untouched", () => {
    const sdp = [
      "v=0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111 0",
      "a=rtpmap:111 opus/48000/2",
      "a=fmtp:111 minptime=10",
      "a=rtpmap:0 PCMU/8000",
      "",
    ].join("\n");
    const result = preferOpusFec(sdp);
    expect(result).toContain("a=rtpmap:0 PCMU/8000");
    expect(result.split("\n").some((line) => line.startsWith("a=fmtp:0"))).toBe(false);
  });

  it("handles CRLF line endings and preserves them in the output", () => {
    const sdp = OPUS_ONLY_LF.replace(/\n/g, "\r\n");
    const result = preferOpusFec(sdp);
    expect(result.includes("\r\n")).toBe(true);
    expect(result.includes("useinbandfec=1")).toBe(true);
    // No bare LF should exist outside of the CRLF pairs.
    expect(result.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  it("returns the SDP unchanged when there is no audio section", () => {
    const sdp = ["v=0", "m=video 9 UDP/TLS/RTP/SAVPF 96", "a=rtpmap:96 VP8/90000", ""].join("\n");
    expect(preferOpusFec(sdp)).toBe(sdp);
  });

  it("returns the SDP unchanged when the audio section has no opus codec", () => {
    const sdp = ["v=0", "m=audio 9 UDP/TLS/RTP/SAVPF 0", "a=rtpmap:0 PCMU/8000", ""].join("\n");
    expect(preferOpusFec(sdp)).toBe(sdp);
  });
});
