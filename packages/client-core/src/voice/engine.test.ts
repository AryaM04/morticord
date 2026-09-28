// Tests for the voice engine: the politeness comparator, ICE candidate
// queueing before the remote description is set, glare handling, the
// speaking hysteresis window, leave() cleanup, and peer add/remove
// reacting to onPeerVoiceState per the newcomer/later-peer offer rule.
// Every WebRTC and Web Audio object is a small hand-written fake; no real
// network or DOM is used.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceStateJson } from "@discord-clone/shared";
import {
  comparePeerKeys,
  createVoiceEngine,
  isPolite,
  JOIN_CONFIRM_TIMEOUT_MS,
  NEWCOMER_TRACK_SHARE_DELAY_MS,
  SPEAKING_OFF_MS,
  SPEAKING_TICK_MS,
  SPEAKING_VOLUME_THRESHOLD,
  type VoiceEngineDeps,
} from "./engine.js";
import type { PeerKey, SignalPayload, SignalTransport } from "./signal-transport.js";

const OPUS_SDP = [
  "v=0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10",
  "",
].join("\r\n");

// ---- fakes ------------------------------------------------------------------

class FakeTrack {
  stopped = false;
  enabled = true;
  onended: (() => void) | null = null;
  onmute: (() => void) | null = null;
  constructor(public readonly kind: "audio" | "video" = "audio") {}
  stop(): void {
    this.stopped = true;
  }
}

let streamCounter = 0;

class FakeMediaStream {
  readonly id: string;
  constructor(
    private readonly tracks: FakeTrack[] = [new FakeTrack()],
    id?: string,
  ) {
    streamCounter += 1;
    this.id = id ?? `stream-${streamCounter}`;
  }
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === "video");
  }
}

class FakeTransceiver {
  sender: FakeSender;
  direction: string;
  constructor(track: FakeTrack | null, direction: string) {
    this.sender = new FakeSender(track);
    this.direction = direction;
  }
}

class FakeSender {
  constructor(public track: FakeTrack | null) {}
  getParameters(): RTCRtpSendParameters {
    return { encodings: [{}] } as unknown as RTCRtpSendParameters;
  }
  async setParameters(): Promise<void> {}
  async replaceTrack(track: FakeTrack | null): Promise<void> {
    this.track = track;
  }
}

type SignalingState = "stable" | "have-local-offer" | "have-remote-offer";

class FakePeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  signalingState: SignalingState = "stable";
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  senders: FakeSender[] = [];
  offerCount = 0;
  answerCount = 0;
  restartIceCalls = 0;
  closed = false;
  addedCandidates: RTCIceCandidateInit[] = [];
  transceivers: FakeTransceiver[] = [];

  ontrack: ((event: { track: FakeTrack; streams: FakeMediaStream[] }) => void) | null = null;
  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;

  addTrack(track: FakeTrack, _stream: FakeMediaStream): FakeSender {
    const sender = new FakeSender(track);
    this.senders.push(sender);
    return sender;
  }
  getSenders(): FakeSender[] {
    return this.senders;
  }
  addTransceiver(track: FakeTrack, init?: { direction?: string; streams?: FakeMediaStream[] }): FakeTransceiver {
    const transceiver = new FakeTransceiver(track, init?.direction ?? "sendrecv");
    this.transceivers.push(transceiver);
    return transceiver;
  }
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.offerCount += 1;
    return { type: "offer", sdp: OPUS_SDP };
  }
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    this.answerCount += 1;
    return { type: "answer", sdp: OPUS_SDP };
  }
  async setLocalDescription(description?: RTCSessionDescriptionInit): Promise<void> {
    if (description?.type === "rollback") {
      this.signalingState = "stable";
      this.localDescription = null;
      return;
    }
    this.localDescription = description ?? null;
    this.signalingState = description?.type === "offer" ? "have-local-offer" : "stable";
  }
  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description;
    this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
  }
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.addedCandidates.push(candidate);
  }
  restartIce(): void {
    this.restartIceCalls += 1;
  }
  close(): void {
    this.closed = true;
    this.connectionState = "closed";
  }
}

class FakeAnalyser {
  fftSize = 512;
  frequencyBinCount = 32;
  /** Test-controlled average byte value the next sample returns. */
  value = 0;
  getByteFrequencyData(buffer: Uint8Array): void {
    buffer.fill(this.value);
  }
}

class FakeAudioNode {
  connect(): void {}
  disconnect(): void {}
}

class FakeGainNode extends FakeAudioNode {
  gain = { value: 1 };
}

class FakeAudioContext {
  closed = false;
  destination = new FakeAudioNode();
  lastAnalyser: FakeAnalyser | null = null;
  createGain(): FakeGainNode {
    return new FakeGainNode();
  }
  createMediaStreamSource(_stream: unknown): FakeAudioNode {
    return new FakeAudioNode();
  }
  createAnalyser(): FakeAnalyser {
    const analyser = new FakeAnalyser();
    this.lastAnalyser = analyser;
    return analyser;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeSignalTransport implements SignalTransport {
  sent: Array<{ target: PeerKey; payload: SignalPayload }> = [];
  private readonly handlers = new Set<(from: PeerKey, payload: SignalPayload) => void>();
  closed = false;

  send(target: PeerKey, payload: SignalPayload): void {
    this.sent.push({ target, payload });
  }
  onSignal(handler: (from: PeerKey, payload: SignalPayload) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  close(): void {
    this.closed = true;
    this.handlers.clear();
  }
  emit(from: PeerKey, payload: SignalPayload): void {
    for (const handler of this.handlers) {
      handler(from, payload);
    }
  }
}

interface TestSetup {
  deps: VoiceEngineDeps;
  pcs: FakePeerConnection[];
  transport: FakeSignalTransport;
  audioContexts: FakeAudioContext[];
  streams: FakeMediaStream[];
}

function makeDeps(overrides: Partial<VoiceEngineDeps> = {}): TestSetup {
  const pcs: FakePeerConnection[] = [];
  const audioContexts: FakeAudioContext[] = [];
  const streams: FakeMediaStream[] = [];
  const transport = new FakeSignalTransport();

  const deps: VoiceEngineDeps = {
    getTurnCredentials: async () => ({ iceServers: [], ttlSeconds: 3600 }),
    createSignalTransport: () => transport,
    sendVoiceJoin: vi.fn(),
    sendVoiceLeave: vi.fn(),
    sendVoiceState: vi.fn(),
    getInitialPeers: () => [],
    selfUserId: "a",
    selfDeviceId: "d1",
    createPeerConnection: () => {
      const pc = new FakePeerConnection();
      pcs.push(pc);
      return pc as unknown as RTCPeerConnection;
    },
    getUserMedia: async (constraints?: MediaStreamConstraints) => {
      const wantsVideo = Boolean(constraints && (constraints as { video?: unknown }).video);
      const stream = new FakeMediaStream([new FakeTrack(wantsVideo ? "video" : "audio")]);
      streams.push(stream);
      return stream as unknown as MediaStream;
    },
    getDisplayMedia: async () => {
      const stream = new FakeMediaStream([new FakeTrack("video"), new FakeTrack("audio")]);
      streams.push(stream);
      return stream as unknown as MediaStream;
    },
    createAudioContext: () => {
      const ctx = new FakeAudioContext();
      audioContexts.push(ctx);
      return ctx as unknown as AudioContext;
    },
    ...overrides,
  };

  return { deps, pcs, transport, audioContexts, streams };
}

/**
 * The server's own echo of a join: `join()` waits for this (see
 * JOIN_CONFIRM_TIMEOUT_MS in engine.ts) before it signals anyone, so a
 * real-timer test must deliver it, the same way the real server does.
 */
function selfJoinUpdate(deps: VoiceEngineDeps, guildId: string, channelId: string): VoiceStateJson {
  return {
    guildId,
    channelId,
    userId: deps.selfUserId,
    deviceId: deps.selfDeviceId,
    selfMute: false,
    selfDeaf: false,
    selfVideo: false,
    selfStream: false,
    joinedAt: new Date().toISOString(),
  };
}

/** Start `join()`, deliver the server's own join echo, then wait for it to finish. */
async function joinAndConfirm(
  engine: ReturnType<typeof createVoiceEngine>,
  deps: VoiceEngineDeps,
  guildId: string,
  channelId: string,
): Promise<void> {
  const joinPromise = engine.join(guildId, channelId);
  await vi.waitFor(() => expect(deps.sendVoiceJoin).toHaveBeenCalled());
  engine.onPeerVoiceState(selfJoinUpdate(deps, guildId, channelId));
  await joinPromise;
}

// ---- politeness comparator ---------------------------------------------------

describe("comparePeerKeys / isPolite", () => {
  it("orders peer keys by the joined userId:deviceId string", () => {
    expect(comparePeerKeys({ userId: "a", deviceId: "d1" }, { userId: "b", deviceId: "d1" })).toBeLessThan(0);
    expect(comparePeerKeys({ userId: "b", deviceId: "d1" }, { userId: "a", deviceId: "d1" })).toBeGreaterThan(0);
    expect(comparePeerKeys({ userId: "a", deviceId: "d1" }, { userId: "a", deviceId: "d1" })).toBe(0);
  });

  it("the lower-sorting side is polite, and the two sides never agree", () => {
    const a: PeerKey = { userId: "a", deviceId: "d1" };
    const b: PeerKey = { userId: "b", deviceId: "d1" };
    expect(isPolite(a, b)).toBe(true);
    expect(isPolite(b, a)).toBe(false);
  });
});

// ---- ICE candidate queueing ---------------------------------------------------

describe("ICE candidate queueing", () => {
  it("queues a candidate that arrives before the remote description, then flushes it", async () => {
    const peerB: PeerKey = { userId: "b", deviceId: "d1" };
    const { deps, pcs, transport } = makeDeps({ getInitialPeers: () => [peerB] });
    const engine = createVoiceEngine(deps);

    await joinAndConfirm(engine, deps, "guild-1", "channel-1");
    const pc = pcs[0]!;
    expect(pc.offerCount).toBe(1); // newcomer offered to the initial peer

    transport.emit(peerB, { kind: "candidate", candidate: { candidate: "c1" } });
    expect(pc.addedCandidates).toHaveLength(0); // no remote description yet: queued, not applied

    transport.emit(peerB, { kind: "description", description: { type: "answer", sdp: OPUS_SDP } });
    await vi.waitFor(() => expect(pc.remoteDescription).not.toBeNull());
    await vi.waitFor(() => expect(pc.addedCandidates).toHaveLength(1));
    expect(pc.addedCandidates[0]).toEqual({ candidate: "c1" });
  });
});

// ---- glare handling ------------------------------------------------------------

describe("glare handling", () => {
  it("the polite side rolls back its own offer and accepts the peer's instead", async () => {
    // self = "a:d1", peer = "b:d1" -> self is polite (see comparePeerKeys).
    const peerB: PeerKey = { userId: "b", deviceId: "d1" };
    const { deps, pcs, transport } = makeDeps({ selfUserId: "a", selfDeviceId: "d1", getInitialPeers: () => [peerB] });
    const engine = createVoiceEngine(deps);

    await joinAndConfirm(engine, deps, "guild-1", "channel-1");
    const pc = pcs[0]!;
    expect(pc.signalingState).toBe("have-local-offer"); // our own offer is in flight

    transport.emit(peerB, { kind: "description", description: { type: "offer", sdp: OPUS_SDP } });
    await vi.waitFor(() => expect(pc.remoteDescription).not.toBeNull());

    expect(pc.remoteDescription?.type).toBe("offer"); // accepted the peer's offer after rollback
    expect(pc.answerCount).toBe(1); // and answered it
  });

  it("the impolite side ignores an offer that collides with its own in-flight offer", async () => {
    // self = "b:d1", peer = "a:d1" -> self is impolite.
    const peerA: PeerKey = { userId: "a", deviceId: "d1" };
    const { deps, pcs, transport } = makeDeps({ selfUserId: "b", selfDeviceId: "d1", getInitialPeers: () => [peerA] });
    const engine = createVoiceEngine(deps);

    await joinAndConfirm(engine, deps, "guild-1", "channel-1");
    const pc = pcs[0]!;
    expect(pc.signalingState).toBe("have-local-offer");

    transport.emit(peerA, { kind: "description", description: { type: "offer", sdp: OPUS_SDP } });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(pc.remoteDescription).toBeNull(); // ignored, not applied
    expect(pc.answerCount).toBe(0);
  });
});

// ---- speaking hysteresis --------------------------------------------------------

describe("speaking hysteresis", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("turns on after one tick above threshold, and off only after 300ms continuously below", async () => {
    const { deps, audioContexts } = makeDeps();
    const engine = createVoiceEngine(deps);
    const speakingEvents: boolean[] = [];
    engine.on("localSpeaking", (speaking) => speakingEvents.push(speaking));

    const joinPromise = engine.join("guild-1", "channel-1");
    await vi.advanceTimersByTimeAsync(JOIN_CONFIRM_TIMEOUT_MS);
    await joinPromise;

    const analyser = audioContexts[0]!.lastAnalyser!;

    // Silent: no change.
    analyser.value = 0;
    await vi.advanceTimersByTimeAsync(SPEAKING_TICK_MS);
    expect(speakingEvents).toEqual([]);

    // One tick above threshold: speaking turns on immediately.
    analyser.value = SPEAKING_VOLUME_THRESHOLD + 50;
    await vi.advanceTimersByTimeAsync(SPEAKING_TICK_MS);
    expect(speakingEvents).toEqual([true]);

    // Drop below threshold: speaking must stay on until 300ms pass.
    analyser.value = 0;
    await vi.advanceTimersByTimeAsync(SPEAKING_TICK_MS);
    expect(speakingEvents).toEqual([true]); // 100ms below: still speaking
    await vi.advanceTimersByTimeAsync(SPEAKING_TICK_MS);
    expect(speakingEvents).toEqual([true]); // 200ms below: still speaking
    await vi.advanceTimersByTimeAsync(SPEAKING_TICK_MS);
    expect(speakingEvents).toEqual([true, false]); // 300ms below: turns off
    expect(SPEAKING_OFF_MS).toBe(300);
  });
});

// ---- leave() cleanup -------------------------------------------------------------

describe("leave()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops every track, closes every peer connection, closes the audio context and clears all timers", async () => {
    const peerB: PeerKey = { userId: "b", deviceId: "d1" };
    const { deps, pcs, streams, audioContexts } = makeDeps({ getInitialPeers: () => [peerB] });
    const engine = createVoiceEngine(deps);

    const joinPromise = engine.join("guild-1", "channel-1");
    // The confirm wait, then the newcomer's pause before moving on to
    // the next initial peer (there is only one here, but join() still
    // waits it out before resolving).
    await vi.advanceTimersByTimeAsync(JOIN_CONFIRM_TIMEOUT_MS + NEWCOMER_TRACK_SHARE_DELAY_MS);
    await joinPromise;

    expect(pcs).toHaveLength(1);
    expect(streams).toHaveLength(1);
    expect(vi.getTimerCount()).toBeGreaterThan(0); // the shared speaking timer is running

    await engine.leave();

    for (const stream of streams) {
      for (const track of stream.getTracks()) {
        expect(track.stopped).toBe(true);
      }
    }
    for (const pc of pcs) {
      expect(pc.closed).toBe(true);
    }
    for (const ctx of audioContexts) {
      expect(ctx.closed).toBe(true);
    }
    expect(vi.getTimerCount()).toBe(0);
    expect(deps.sendVoiceLeave).toHaveBeenCalledTimes(1);
  });

  it("is a safe no-op when not in a call", async () => {
    const { deps } = makeDeps();
    const engine = createVoiceEngine(deps);
    await engine.leave();
    expect(deps.sendVoiceLeave).not.toHaveBeenCalled();
  });
});

// ---- peer add/remove from onPeerVoiceState ---------------------------------------

describe("onPeerVoiceState", () => {
  it("prepares a connection for a later peer without offering, and removes a peer who leaves", async () => {
    const { deps, pcs } = makeDeps(); // no initial peers: we are already in the channel alone
    const engine = createVoiceEngine(deps);
    await joinAndConfirm(engine, deps, "guild-1", "channel-1");
    expect(pcs).toHaveLength(0);

    const laterPeer: VoiceStateJson = {
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "b",
      deviceId: "d1",
      selfMute: false,
      selfDeaf: false,
      selfVideo: false,
      selfStream: false,
      joinedAt: new Date().toISOString(),
    };
    engine.onPeerVoiceState(laterPeer);
    await Promise.resolve();
    await Promise.resolve();

    expect(pcs).toHaveLength(1);
    expect(pcs[0]!.offerCount).toBe(0); // we wait for their offer; we do not offer to a later joiner
    expect(engine.peers).toHaveLength(1);

    engine.onPeerVoiceState({ ...laterPeer, channelId: null });
    expect(engine.peers).toHaveLength(0);
    expect(pcs[0]!.closed).toBe(true);
  });

  it("cleans up locally when the server reports our own voice state left", async () => {
    const { deps } = makeDeps();
    const engine = createVoiceEngine(deps);
    await joinAndConfirm(engine, deps, "guild-1", "channel-1");

    engine.onPeerVoiceState({
      guildId: "guild-1",
      channelId: null,
      userId: "a",
      deviceId: "d1",
      selfMute: false,
      selfDeaf: false,
      selfVideo: false,
      selfStream: false,
      joinedAt: new Date().toISOString(),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.sendVoiceLeave).not.toHaveBeenCalled(); // local cleanup only, no extra VOICE_LEAVE
  });
});

// ---- camera --------------------------------------------------------------------

describe("setCamera", () => {
  it("adds one transceiver on the first toggle and reuses it on every later toggle", async () => {
    const { deps, pcs } = makeDeps();
    const engine = createVoiceEngine(deps);
    await joinAndConfirm(engine, deps, "guild-1", "channel-1");

    // A later peer, so a peer connection exists to hold the transceiver.
    engine.onPeerVoiceState({
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "b",
      deviceId: "d1",
      selfMute: false,
      selfDeaf: false,
      selfVideo: false,
      selfStream: false,
      joinedAt: new Date().toISOString(),
    });
    await Promise.resolve();
    await Promise.resolve();
    const pc = pcs[0]!;

    await engine.setCamera(true);
    await engine.setCamera(false);
    await engine.setCamera(true);

    const cameraTransceivers = pc.transceivers.filter((t) => t.sender.track?.kind === "video" || t.direction === "sendonly");
    expect(pc.transceivers).toHaveLength(1); // toggling 3 times never adds a second transceiver
    expect(pc.transceivers[0]!.sender.track).not.toBeNull(); // last toggle left the track attached
    expect(cameraTransceivers).toHaveLength(1);
    expect(deps.sendVoiceState).toHaveBeenCalledWith({ selfVideo: true });
  });

  it("sends selfVideo=false and stops the track when turned off", async () => {
    const { deps, streams } = makeDeps();
    const engine = createVoiceEngine(deps);
    await joinAndConfirm(engine, deps, "guild-1", "channel-1");

    await engine.setCamera(true);
    const cameraStream = streams.find((s) => s.getVideoTracks().length > 0)!;
    await engine.setCamera(false);

    expect(deps.sendVoiceState).toHaveBeenCalledWith({ selfVideo: false });
    expect(cameraStream.getVideoTracks()[0]!.stopped).toBe(true);
  });
});

// ---- screen share ----------------------------------------------------------------

describe("setScreenShare", () => {
  it("waits for the server's confirmation before it captures the screen", async () => {
    const { deps } = makeDeps();
    const getDisplayMedia = vi.fn(deps.getDisplayMedia);
    const engine = createVoiceEngine({ ...deps, getDisplayMedia });
    await joinAndConfirm(engine, deps, "guild-1", "channel-1");

    const sharePromise = engine.setScreenShare(true);
    await vi.waitFor(() => expect(deps.sendVoiceState).toHaveBeenCalledWith({ selfStream: true }));
    expect(getDisplayMedia).not.toHaveBeenCalled(); // no capture before the server confirms

    engine.onPeerVoiceState({
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "a",
      deviceId: "d1",
      selfMute: false,
      selfDeaf: false,
      selfVideo: false,
      selfStream: true,
      joinedAt: new Date().toISOString(),
    });
    await sharePromise;

    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(engine.screenOn).toBe(true);
  });

  it("does not capture the screen on STREAM_IN_USE", async () => {
    const { deps } = makeDeps();
    const getDisplayMedia = vi.fn(deps.getDisplayMedia);
    const engine = createVoiceEngine({ ...deps, getDisplayMedia });
    const errors: string[] = [];
    engine.on("error", (e) => errors.push(e.kind));
    await joinAndConfirm(engine, deps, "guild-1", "channel-1");

    const sharePromise = engine.setScreenShare(true);
    await vi.waitFor(() => expect(deps.sendVoiceState).toHaveBeenCalledWith({ selfStream: true }));
    engine.handleVoiceError({ code: "STREAM_IN_USE", message: "Someone else is already sharing." });
    await sharePromise;

    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(engine.screenOn).toBe(false);
    expect(errors).toContain("voice-error");
  });

  it("turns selfStream off when the browser's own Stop sharing control ends the track", async () => {
    const { deps, streams } = makeDeps();
    const engine = createVoiceEngine(deps);
    await joinAndConfirm(engine, deps, "guild-1", "channel-1");

    const sharePromise = engine.setScreenShare(true);
    await vi.waitFor(() => expect(deps.sendVoiceState).toHaveBeenCalledWith({ selfStream: true }));
    engine.onPeerVoiceState({
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "a",
      deviceId: "d1",
      selfMute: false,
      selfDeaf: false,
      selfVideo: false,
      selfStream: true,
      joinedAt: new Date().toISOString(),
    });
    await sharePromise;
    expect(engine.screenOn).toBe(true);

    const screenStream = streams.find((s) => s.getVideoTracks().length > 0 && s.getAudioTracks().length > 0)!;
    const videoTrack = screenStream.getVideoTracks()[0]! as unknown as { onended: (() => void) | null };
    videoTrack.onended!();
    await vi.waitFor(() => expect(deps.sendVoiceState).toHaveBeenCalledWith({ selfStream: false }));
    expect(engine.screenOn).toBe(false);
  });

  it("rolls back selfStream when the browser denies screen capture", async () => {
    const { deps } = makeDeps({
      getDisplayMedia: async () => {
        throw new Error("denied");
      },
    });
    const engine = createVoiceEngine(deps);
    const errors: string[] = [];
    engine.on("error", (e) => errors.push(e.kind));
    await joinAndConfirm(engine, deps, "guild-1", "channel-1");

    const sharePromise = engine.setScreenShare(true);
    await vi.waitFor(() => expect(deps.sendVoiceState).toHaveBeenCalledWith({ selfStream: true }));
    engine.onPeerVoiceState({
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "a",
      deviceId: "d1",
      selfMute: false,
      selfDeaf: false,
      selfVideo: false,
      selfStream: true,
      joinedAt: new Date().toISOString(),
    });
    await sharePromise;

    expect(deps.sendVoiceState).toHaveBeenCalledWith({ selfStream: false });
    expect(engine.screenOn).toBe(false);
    expect(errors).toContain("screen-permission-denied");
  });
});

// ---- remote camera/screen identification ------------------------------------------

describe("remote media identification", () => {
  it("matches ontrack to the media signal when the signal arrives first", async () => {
    const peerB: PeerKey = { userId: "b", deviceId: "d1" };
    const { deps, pcs, transport } = makeDeps({ getInitialPeers: () => [peerB] });
    const engine = createVoiceEngine(deps);
    await joinAndConfirm(engine, deps, "guild-1", "channel-1");
    const pc = pcs[0]!;

    transport.emit(peerB, { kind: "media", streams: { camera: "remote-cam-1" } });
    expect(engine.peers[0]!.cameraStream).toBeNull(); // no track yet

    const remoteStream = new FakeMediaStream([new FakeTrack("video")], "remote-cam-1");
    pc.ontrack!({ track: remoteStream.getVideoTracks()[0]!, streams: [remoteStream] });

    expect(engine.peers[0]!.cameraStream).not.toBeNull();
  });

  it("matches ontrack to the media signal when the track arrives first", async () => {
    const peerB: PeerKey = { userId: "b", deviceId: "d1" };
    const { deps, pcs, transport } = makeDeps({ getInitialPeers: () => [peerB] });
    const engine = createVoiceEngine(deps);
    await joinAndConfirm(engine, deps, "guild-1", "channel-1");
    const pc = pcs[0]!;

    const remoteStream = new FakeMediaStream([new FakeTrack("video")], "remote-screen-1");
    pc.ontrack!({ track: remoteStream.getVideoTracks()[0]!, streams: [remoteStream] });
    expect(engine.peers[0]!.screenStream).toBeNull(); // no signal yet, held pending

    transport.emit(peerB, { kind: "media", streams: { screen: "remote-screen-1" } });

    expect(engine.peers[0]!.screenStream).not.toBeNull();
  });

  it("clears the remote camera stream once the media signal reports it off", async () => {
    const peerB: PeerKey = { userId: "b", deviceId: "d1" };
    const { deps, pcs, transport } = makeDeps({ getInitialPeers: () => [peerB] });
    const engine = createVoiceEngine(deps);
    await joinAndConfirm(engine, deps, "guild-1", "channel-1");
    const pc = pcs[0]!;

    transport.emit(peerB, { kind: "media", streams: { camera: "remote-cam-2" } });
    const remoteStream = new FakeMediaStream([new FakeTrack("video")], "remote-cam-2");
    pc.ontrack!({ track: remoteStream.getVideoTracks()[0]!, streams: [remoteStream] });
    expect(engine.peers[0]!.cameraStream).not.toBeNull();

    transport.emit(peerB, { kind: "media", streams: {} });
    expect(engine.peers[0]!.cameraStream).toBeNull();
  });
});

// ---- leave() stops video tracks too ------------------------------------------------

describe("leave() with camera and screen on", () => {
  it("stops the camera and screen tracks", async () => {
    const { deps, streams } = makeDeps();
    const engine = createVoiceEngine(deps);
    await joinAndConfirm(engine, deps, "guild-1", "channel-1");

    await engine.setCamera(true);
    const sharePromise = engine.setScreenShare(true);
    await vi.waitFor(() => expect(deps.sendVoiceState).toHaveBeenCalledWith({ selfStream: true }));
    engine.onPeerVoiceState({
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "a",
      deviceId: "d1",
      selfMute: false,
      selfDeaf: false,
      selfVideo: true,
      selfStream: true,
      joinedAt: new Date().toISOString(),
    });
    await sharePromise;

    await engine.leave();

    for (const stream of streams) {
      for (const track of stream.getTracks()) {
        expect(track.stopped).toBe(true);
      }
    }
    expect(engine.cameraOn).toBe(false);
    expect(engine.screenOn).toBe(false);
  });
});
