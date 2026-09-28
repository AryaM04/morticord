// Tests for the adaptive video quality policy: table-driven camera tiers,
// bitrate caps and floors, step-down/step-up hysteresis, the peer-count
// ceiling, and the screen-share frame rate rules. Every input is a plain
// value; nothing here touches WebRTC.
import { describe, expect, it } from "vitest";
import {
  CAMERA_MIN_BITRATE_BPS,
  SCREEN_FRAMERATE_FEW_PEERS,
  SCREEN_FRAMERATE_LIMITED,
  SCREEN_FRAMERATE_MANY_PEERS,
  SCREEN_MIN_BITRATE_BPS,
  STEP_UP_COOLDOWN_MS,
  cameraTierForPeerCount,
  chooseVideoEncoding,
} from "./adaptive.js";

describe("cameraTierForPeerCount / camera tier table", () => {
  it.each([
    [1, 0, 720, 30, 1_500_000],
    [2, 0, 720, 30, 1_500_000],
    [3, 1, 540, 30, 800_000],
    [4, 1, 540, 30, 800_000],
    [5, 2, 360, 24, 400_000],
    [7, 2, 360, 24, 400_000],
    [8, 3, 180, 15, 200_000],
    [9, 3, 180, 15, 200_000],
  ])("%i remote peers -> tier %i (%ip%i, %ibps)", (remotePeerCount, tier, height, framerate, bitrateBps) => {
    expect(cameraTierForPeerCount(remotePeerCount)).toBe(tier);
    const result = chooseVideoEncoding({
      kind: "camera",
      remotePeerCount,
      sourceHeight: height,
      activeVideoSenders: 1,
      limitedSamples: 0,
    });
    expect(result.tier).toBe(tier);
    expect(result.maxFramerate).toBe(framerate);
    expect(result.maxBitrate).toBe(bitrateBps);
    expect(result.scaleResolutionDownBy).toBe(1);
  });
});

describe("scaleResolutionDownBy", () => {
  it("scales a 1080p source down to the 720p tier for 1-2 peers", () => {
    const result = chooseVideoEncoding({
      kind: "camera",
      remotePeerCount: 1,
      sourceHeight: 1080,
      activeVideoSenders: 1,
      limitedSamples: 0,
    });
    expect(result.scaleResolutionDownBy).toBeCloseTo(1080 / 720);
  });

  it("does not upscale a 720p source for the 360p tier (5-7 peers)", () => {
    const result = chooseVideoEncoding({
      kind: "camera",
      remotePeerCount: 6,
      sourceHeight: 720,
      activeVideoSenders: 1,
      limitedSamples: 0,
    });
    expect(result.scaleResolutionDownBy).toBeCloseTo(720 / 360);
    expect(result.scaleResolutionDownBy).toBeGreaterThanOrEqual(1);
  });
});

describe("bitrate cap from availableOutgoingBitrate", () => {
  it("caps below the tier bitrate when the measured uplink is tight, split across 2 senders", () => {
    // 1 remote peer, 2 active senders (camera + screen), 1,000,000 bps uplink:
    // cap = 1,000,000 * 0.85 / (1 * 2) = 425,000, below the 720p tier's 1.5Mbps.
    const result = chooseVideoEncoding({
      kind: "camera",
      remotePeerCount: 1,
      sourceHeight: 720,
      activeVideoSenders: 2,
      availableOutgoingBitrate: 1_000_000,
      limitedSamples: 0,
    });
    expect(result.maxBitrate).toBe(425_000);
  });

  it("leaves the tier bitrate untouched when the measured uplink comfortably exceeds it", () => {
    const result = chooseVideoEncoding({
      kind: "camera",
      remotePeerCount: 1,
      sourceHeight: 720,
      activeVideoSenders: 1,
      availableOutgoingBitrate: 100_000_000,
      limitedSamples: 0,
    });
    expect(result.maxBitrate).toBe(1_500_000);
  });

  it("never drops the camera bitrate below the 100 kbps floor", () => {
    const result = chooseVideoEncoding({
      kind: "camera",
      remotePeerCount: 9,
      sourceHeight: 180,
      activeVideoSenders: 2,
      availableOutgoingBitrate: 10_000,
      limitedSamples: 0,
    });
    expect(result.maxBitrate).toBe(CAMERA_MIN_BITRATE_BPS);
  });

  it("never drops the screen bitrate below the 300 kbps floor", () => {
    const result = chooseVideoEncoding({
      kind: "screen",
      remotePeerCount: 9,
      sourceHeight: 1080,
      activeVideoSenders: 2,
      availableOutgoingBitrate: 10_000,
      limitedSamples: 0,
    });
    expect(result.maxBitrate).toBe(SCREEN_MIN_BITRATE_BPS);
  });
});

describe("step down on consecutive limited samples", () => {
  it("does not step down after only 1 limited sample", () => {
    const result = chooseVideoEncoding({
      kind: "camera",
      remotePeerCount: 1,
      sourceHeight: 720,
      activeVideoSenders: 1,
      limitedSamples: 1,
      previousTier: 0,
    });
    expect(result.tier).toBe(0);
  });

  it("steps down one tier after 2 consecutive limited samples", () => {
    const result = chooseVideoEncoding({
      kind: "camera",
      remotePeerCount: 1,
      sourceHeight: 720,
      activeVideoSenders: 1,
      limitedSamples: 2,
      previousTier: 0,
    });
    expect(result.tier).toBe(1);
  });

  it("never steps down past the worst tier", () => {
    const result = chooseVideoEncoding({
      kind: "camera",
      remotePeerCount: 1,
      sourceHeight: 720,
      activeVideoSenders: 1,
      limitedSamples: 2,
      previousTier: 3,
    });
    expect(result.tier).toBe(3);
  });
});

describe("step up hysteresis", () => {
  it("blocks a step up before the 10s cooldown elapses", () => {
    const result = chooseVideoEncoding({
      kind: "camera",
      remotePeerCount: 1,
      sourceHeight: 720,
      activeVideoSenders: 1,
      limitedSamples: 0,
      previousTier: 2,
      msSinceLastStepUp: STEP_UP_COOLDOWN_MS - 1,
    });
    expect(result.tier).toBe(2);
  });

  it("allows a step up once the 10s cooldown has elapsed", () => {
    const result = chooseVideoEncoding({
      kind: "camera",
      remotePeerCount: 1,
      sourceHeight: 720,
      activeVideoSenders: 1,
      limitedSamples: 0,
      previousTier: 2,
      msSinceLastStepUp: STEP_UP_COOLDOWN_MS,
    });
    expect(result.tier).toBe(1);
  });

  it("steps up by at most one tier per call, even when far from the peer-count tier", () => {
    const result = chooseVideoEncoding({
      kind: "camera",
      remotePeerCount: 1,
      sourceHeight: 720,
      activeVideoSenders: 1,
      limitedSamples: 0,
      previousTier: 3,
      msSinceLastStepUp: STEP_UP_COOLDOWN_MS,
    });
    expect(result.tier).toBe(2);
  });

  it("allows the first-ever step up with no cooldown recorded yet", () => {
    const result = chooseVideoEncoding({
      kind: "camera",
      remotePeerCount: 1,
      sourceHeight: 720,
      activeVideoSenders: 1,
      limitedSamples: 0,
      previousTier: 1,
    });
    expect(result.tier).toBe(0);
  });
});

describe("never above the peer-count tier", () => {
  it("clamps a tier that used to be better than the current peer count allows", () => {
    // The peer count grew (3-4 peers -> tier 1), but the sender was still
    // sitting at tier 0 (720p, from when there were only 1-2 peers).
    const result = chooseVideoEncoding({
      kind: "camera",
      remotePeerCount: 3,
      sourceHeight: 720,
      activeVideoSenders: 1,
      limitedSamples: 0,
      previousTier: 0,
    });
    expect(result.tier).toBe(1);
  });

  it("a step up never goes past the peer-count tier", () => {
    const result = chooseVideoEncoding({
      kind: "camera",
      remotePeerCount: 5, // peer-count tier is 2
      sourceHeight: 720,
      activeVideoSenders: 1,
      limitedSamples: 0,
      previousTier: 2,
      msSinceLastStepUp: STEP_UP_COOLDOWN_MS,
    });
    expect(result.tier).toBe(2);
  });
});

describe("screen share", () => {
  it("keeps the source resolution unscaled at or below 1080p", () => {
    const result = chooseVideoEncoding({
      kind: "screen",
      remotePeerCount: 1,
      sourceHeight: 1080,
      activeVideoSenders: 1,
      limitedSamples: 0,
    });
    expect(result.scaleResolutionDownBy).toBe(1);
  });

  it("caps a taller-than-1080p source down to 1080p", () => {
    const result = chooseVideoEncoding({
      kind: "screen",
      remotePeerCount: 1,
      sourceHeight: 1440,
      activeVideoSenders: 1,
      limitedSamples: 0,
    });
    expect(result.scaleResolutionDownBy).toBeCloseTo(1440 / 1080);
  });

  it("uses 15fps for 3 or fewer remote peers", () => {
    const result = chooseVideoEncoding({
      kind: "screen",
      remotePeerCount: 3,
      sourceHeight: 1080,
      activeVideoSenders: 1,
      limitedSamples: 0,
    });
    expect(result.maxFramerate).toBe(SCREEN_FRAMERATE_FEW_PEERS);
  });

  it("drops to 8fps above 3 remote peers", () => {
    const result = chooseVideoEncoding({
      kind: "screen",
      remotePeerCount: 4,
      sourceHeight: 1080,
      activeVideoSenders: 1,
      limitedSamples: 0,
    });
    expect(result.maxFramerate).toBe(SCREEN_FRAMERATE_MANY_PEERS);
  });

  it("drops to 5fps once limited, even with few peers", () => {
    const result = chooseVideoEncoding({
      kind: "screen",
      remotePeerCount: 2,
      sourceHeight: 1080,
      activeVideoSenders: 1,
      limitedSamples: 2,
    });
    expect(result.maxFramerate).toBe(SCREEN_FRAMERATE_LIMITED);
  });

  it("splits the ~2.5 Mbps budget evenly across remote peers", () => {
    const result = chooseVideoEncoding({
      kind: "screen",
      remotePeerCount: 5,
      sourceHeight: 1080,
      activeVideoSenders: 1,
      limitedSamples: 0,
    });
    expect(result.maxBitrate).toBe(500_000);
  });
});
