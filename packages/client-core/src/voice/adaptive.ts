// Adaptive video quality: a pure policy that picks one video sender's
// encoding parameters from the current call state. This file never
// touches a real `RTCRtpSender` or `getStats()` result; the engine reads
// those, builds the plain input object below, and applies the result with
// `sender.setParameters()`. Keeping the policy pure makes every rule in
// this file a table-driven unit test, with no fake WebRTC objects needed.
// See docs/concepts/voice.md and plan section 7 ("Adaptive quality").

/** One remote-peer-count camera tier: the target resolution, frame rate and bitrate ceiling. */
interface CameraTierConfig {
  height: number;
  framerate: number;
  bitrateBps: number;
}

/**
 * Camera tiers, best quality first. The tier index IS the quality rank:
 * index 0 is the best (720p30), index 3 is the worst (180p15). A "step
 * up" always means a lower index; a "step down" always means a higher
 * index.
 */
const CAMERA_TIERS: readonly CameraTierConfig[] = [
  { height: 720, framerate: 30, bitrateBps: 1_500_000 }, // 1-2 remote peers
  { height: 540, framerate: 30, bitrateBps: 800_000 }, // 3-4 remote peers
  { height: 360, framerate: 24, bitrateBps: 400_000 }, // 5-7 remote peers
  { height: 180, framerate: 15, bitrateBps: 200_000 }, // 8-9 remote peers
];

/** A sample counts as "limited" after this many consecutive limited samples: the sender steps down one tier. */
export const STEP_DOWN_AFTER_SAMPLES = 2;
/** A sender may step up (improve) by at most one tier this often. */
export const STEP_UP_COOLDOWN_MS = 10_000;

/** The outgoing bitrate cap leaves this fraction of the measured uplink as headroom for other traffic. */
const BITRATE_HEADROOM_FRACTION = 0.85;

/** Bitrate never drops below this floor, regardless of how little uplink is available. */
export const CAMERA_MIN_BITRATE_BPS = 100_000;
export const SCREEN_MIN_BITRATE_BPS = 300_000;

/** Screen share's own base bitrate budget, split evenly across remote peers. */
const SCREEN_BASE_BITRATE_BPS = 2_500_000;
/** Screen share never sends a taller picture than this, regardless of the capture source. */
export const SCREEN_MAX_HEIGHT = 1080;
export const SCREEN_FRAMERATE_FEW_PEERS = 15;
export const SCREEN_FRAMERATE_MANY_PEERS = 8;
export const SCREEN_FRAMERATE_LIMITED = 5;
/** Above this many remote peers, screen share drops from the high frame rate to the lower one. */
const SCREEN_MANY_PEERS_THRESHOLD = 3;

export type VideoEncodingKind = "camera" | "screen";

export interface VideoEncodingInput {
  kind: VideoEncodingKind;
  /** How many other peers are in the call right now. */
  remotePeerCount: number;
  /** The captured track's actual height, before any scaling. */
  sourceHeight: number;
  /** The selected candidate pair's `availableOutgoingBitrate`, when `getStats()` reports one. */
  availableOutgoingBitrate?: number;
  /** How many local video tracks (camera and/or screen) currently share the uplink. */
  activeVideoSenders: number;
  /** Consecutive samples in a row with `qualityLimitationReason` "cpu" or "bandwidth". Resets to 0 on an unlimited sample. */
  limitedSamples: number;
  /** The tier this sender was last set to, camera only. Omit on the first tick for a sender. */
  previousTier?: number;
  /** Time since this sender last stepped up a tier, camera only. Omit when it has never stepped up. */
  msSinceLastStepUp?: number;
}

export interface VideoEncodingResult {
  maxBitrate: number;
  scaleResolutionDownBy: number;
  maxFramerate: number;
  /** The chosen tier index. Camera: 0 (best) to 3 (worst), matching `CAMERA_TIERS`. Screen: 0 (15fps) to 2 (5fps). */
  tier: number;
}

/** The best (lowest-index) tier a camera sender may use for this many remote peers; also its floor: a tier index can never be lower than this. */
export function cameraTierForPeerCount(remotePeerCount: number): number {
  if (remotePeerCount <= 2) return 0;
  if (remotePeerCount <= 4) return 1;
  if (remotePeerCount <= 7) return 2;
  return 3;
}

function bitrateCap(baseBps: number, floorBps: number, input: VideoEncodingInput): number {
  let bps = baseBps;
  if (input.availableOutgoingBitrate !== undefined) {
    const senders = Math.max(1, input.activeVideoSenders);
    const peers = Math.max(1, input.remotePeerCount);
    const measuredCap = (input.availableOutgoingBitrate * BITRATE_HEADROOM_FRACTION) / (peers * senders);
    bps = Math.min(bps, measuredCap);
  }
  return Math.max(floorBps, Math.round(bps));
}

function chooseCameraEncoding(input: VideoEncodingInput): VideoEncodingResult {
  const peerTier = cameraTierForPeerCount(input.remotePeerCount);

  // The peer-count tier is a floor on the index (a ceiling on quality): a
  // sender may never sit at a better tier than the peer count allows,
  // even right after a step up. A peer-count rise clamps here at once,
  // with no hysteresis, because it is a hard limit, not a measurement.
  let tier = Math.max(input.previousTier ?? peerTier, peerTier);

  if (input.limitedSamples >= STEP_DOWN_AFTER_SAMPLES) {
    tier = Math.min(tier + 1, CAMERA_TIERS.length - 1);
  } else if (input.limitedSamples === 0 && tier > peerTier) {
    const cooldownElapsed = input.msSinceLastStepUp === undefined || input.msSinceLastStepUp >= STEP_UP_COOLDOWN_MS;
    if (cooldownElapsed) {
      tier -= 1;
    }
  }

  const config = CAMERA_TIERS[tier]!;
  return {
    maxBitrate: bitrateCap(config.bitrateBps, CAMERA_MIN_BITRATE_BPS, input),
    scaleResolutionDownBy: Math.max(1, input.sourceHeight / config.height),
    maxFramerate: config.framerate,
    tier,
  };
}

function chooseScreenEncoding(input: VideoEncodingInput): VideoEncodingResult {
  let framerate: number;
  let tier: number;
  if (input.limitedSamples >= STEP_DOWN_AFTER_SAMPLES) {
    framerate = SCREEN_FRAMERATE_LIMITED;
    tier = 2;
  } else if (input.remotePeerCount > SCREEN_MANY_PEERS_THRESHOLD) {
    framerate = SCREEN_FRAMERATE_MANY_PEERS;
    tier = 1;
  } else {
    framerate = SCREEN_FRAMERATE_FEW_PEERS;
    tier = 0;
  }

  const baseBps = SCREEN_BASE_BITRATE_BPS / Math.max(1, input.remotePeerCount);
  return {
    maxBitrate: bitrateCap(baseBps, SCREEN_MIN_BITRATE_BPS, input),
    scaleResolutionDownBy: input.sourceHeight > SCREEN_MAX_HEIGHT ? input.sourceHeight / SCREEN_MAX_HEIGHT : 1,
    maxFramerate: framerate,
    tier,
  };
}

/**
 * Pick one video sender's encoding parameters for its next
 * `setParameters()` call. Pure and synchronous: every input the choice
 * depends on is a plain value, so a test needs no fake `RTCRtpSender` or
 * `RTCPeerConnection` to cover every rule.
 */
export function chooseVideoEncoding(input: VideoEncodingInput): VideoEncodingResult {
  return input.kind === "camera" ? chooseCameraEncoding(input) : chooseScreenEncoding(input);
}
