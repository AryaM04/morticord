// The voice engine: the client side of the WebRTC voice mesh. It owns
// one `RTCPeerConnection` per remote peer in the current voice channel,
// the local microphone track, and the Web Audio graph that mixes remote
// audio and drives speaking detection. It has no reference to `window`,
// `document`, `navigator` or the gateway: every browser API and every
// gateway call comes through `VoiceEngineDeps`, so a test can supply
// fakes for all of it. See docs/concepts/voice.md for the wire protocol
// this engine's signal transport rides on.
import type { VoiceErrorCode, VoiceStateJson } from "@discord-clone/shared";
import { applyOpusFec, capOpusBitrate } from "./sdp.js";
import type { PeerKey, SignalPayload, SignalTransport } from "./signal-transport.js";

/** The fixed outgoing audio bitrate cap, per docs/concepts/voice.md and the plan's audio section. */
export const AUDIO_MAX_BITRATE_BPS = 40_000;

/** How often the shared speaking-detection timer samples every audio source. */
export const SPEAKING_TICK_MS = 100;
/** A source must stay below the volume threshold this long before speaking turns off. */
export const SPEAKING_OFF_MS = 300;
/** Average byte value (0-255) from `getByteFrequencyData` above which a source counts as speaking. */
export const SPEAKING_VOLUME_THRESHOLD = 12;

/** Delay before each ICE restart attempt: first attempt after 1 s, second after 2 s. */
export const ICE_RESTART_BACKOFFS_MS = [1_000, 2_000];
/** After this many failed restarts, the peer connection is closed and rebuilt from scratch. */
export const MAX_ICE_RESTARTS = ICE_RESTART_BACKOFFS_MS.length;

/** TURN credentials are re-fetched this long before they actually expire. */
export const TURN_REFRESH_SKEW_MS = 10 * 60 * 1_000;

/** How long `join()` waits for the server's own join echo before signaling anyway. */
export const JOIN_CONFIRM_TIMEOUT_MS = 5_000;

/** Pause between offering to each already-present peer at join. See the comment at its one call site. */
export const NEWCOMER_TRACK_SHARE_DELAY_MS = 600;

/**
 * Decide which side of a peer pair is "polite" for perfect negotiation.
 * Join each (userId, deviceId) pair into one string ("userId:deviceId")
 * and compare the two strings. The side whose string sorts LOWER is
 * polite. Both sides compute this the same way with no extra message,
 * because it depends only on identities both sides already know.
 */
export function comparePeerKeys(a: PeerKey, b: PeerKey): number {
  const aStr = `${a.userId}:${a.deviceId}`;
  const bStr = `${b.userId}:${b.deviceId}`;
  if (aStr < bStr) return -1;
  if (aStr > bStr) return 1;
  return 0;
}

/** True when `self` is the polite side of a negotiation with `peer`. */
export function isPolite(self: PeerKey, peer: PeerKey): boolean {
  return comparePeerKeys(self, peer) < 0;
}

function keyOf(key: PeerKey): string {
  return `${key.userId}:${key.deviceId}`;
}

/** The minimal shape of a remote `<audio>` element this engine needs. Real browser wiring uses `document.createElement("audio")`. */
export interface AudioElementLike {
  srcObject: MediaStream | null;
  muted: boolean;
  setSinkId?(deviceId: string): Promise<void>;
}

export interface VoiceEngineDeps {
  getTurnCredentials(): Promise<{ iceServers: RTCIceServer[]; ttlSeconds: number }>;
  createSignalTransport(channelId: string): SignalTransport;
  sendVoiceJoin(channelId: string, selfMute: boolean, selfDeaf: boolean): void;
  sendVoiceLeave(): void;
  sendVoiceState(patch: { selfMute?: boolean; selfDeaf?: boolean }): void;
  /** Who else is already in the channel, read once at join time (the newcomer offers to each of these). */
  getInitialPeers(channelId: string): PeerKey[];
  selfUserId: string;
  selfDeviceId: string;
  createPeerConnection(config: RTCConfiguration): RTCPeerConnection;
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createAudioContext(): AudioContext;
  /** Builds one remote audio sink. Defaults to `document.createElement("audio")` when `document` exists. */
  createAudioElement?(): AudioElementLike;
  /** Wall clock, injected for tests. Defaults to `Date.now`. */
  now?(): number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

/** One peer's connection state, for the UI to render a roster and derive a connection-quality summary. */
export interface VoicePeerState {
  userId: string;
  deviceId: string;
  connectionState: RTCPeerConnectionState;
  speaking: boolean;
}

export type VoiceEngineErrorKind =
  | "mic-permission-denied"
  | "output-device-unsupported"
  | "voice-error"
  | "ice-failed";

export interface VoiceEngineErrorEvent {
  kind: VoiceEngineErrorKind;
  message: string;
  code?: VoiceErrorCode;
}

export interface VoiceEngineEventMap {
  peers: VoicePeerState[];
  localSpeaking: boolean;
  error: VoiceEngineErrorEvent;
}

class Emitter<T> {
  private readonly listeners = new Set<(value: T) => void>();
  on(handler: (value: T) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }
  emit(value: T): void {
    for (const handler of this.listeners) {
      handler(value);
    }
  }
}

/** One peer's raw connection stats, for a debug panel or an end-to-end test. */
export interface VoiceDebugPeerStats {
  userId: string;
  deviceId: string;
  connectionState: RTCPeerConnectionState;
  /** The selected candidate pair's local candidate type, or null before ICE picks one. */
  selectedCandidateType: string | null;
  inboundBytesReceived: number;
  outboundBytesSent: number;
}

export interface VoiceEngine {
  join(guildId: string, channelId: string): Promise<void>;
  leave(): Promise<void>;
  setMute(muted: boolean): void;
  setDeafen(deafened: boolean): void;
  setInputDevice(deviceId: string): void;
  setOutputDevice(deviceId: string): Promise<void>;
  setUserVolume(userId: string, volume: number): void;
  /** Forward a live VOICE_STATE_UPDATE dispatch for the current channel. See docs/concepts/voice.md. */
  onPeerVoiceState(update: VoiceStateJson): void;
  /** Forward a VOICE_ERROR dispatch. The caller owns the gateway subscription, not this engine. */
  handleVoiceError(payload: { code: VoiceErrorCode; message: string }): void;
  on<K extends keyof VoiceEngineEventMap>(event: K, handler: (value: VoiceEngineEventMap[K]) => void): () => void;
  /** Raw per-peer connection stats, read straight from each `RTCPeerConnection`. For a debug panel or a test, not the normal UI. */
  getDebugStats(): Promise<VoiceDebugPeerStats[]>;
  /** Whether the local microphone track is currently enabled, or null when not in a call. For a debug panel or a test. */
  isLocalTrackEnabled(): boolean | null;
  readonly peers: VoicePeerState[];
  /** The channel this engine is currently in, or null when not in a call. */
  readonly channelId: string | null;
  /** The guild that owns the current channel, or null when not in a call. */
  readonly guildId: string | null;
}

interface SpeakingState {
  analyser: AnalyserNode | null;
  buffer: Uint8Array<ArrayBuffer> | null;
  speaking: boolean;
  belowTicks: number;
}

function createSpeakingState(): SpeakingState {
  return { analyser: null, buffer: null, speaking: false, belowTicks: 0 };
}

/**
 * Sample one audio source's analyser and apply the on/off hysteresis:
 * speaking turns on the first tick a source is above the threshold, and
 * turns off only after it has stayed below the threshold for
 * `SPEAKING_OFF_MS`. Returns the new speaking value when it changed, or
 * `null` when nothing changed this tick (the common case).
 */
function sampleSpeaking(state: SpeakingState): boolean | null {
  if (!state.analyser || !state.buffer) {
    return null;
  }
  state.analyser.getByteFrequencyData(state.buffer);
  let sum = 0;
  for (let i = 0; i < state.buffer.length; i += 1) {
    sum += state.buffer[i]!;
  }
  const average = sum / state.buffer.length;

  if (average > SPEAKING_VOLUME_THRESHOLD) {
    state.belowTicks = 0;
    if (!state.speaking) {
      state.speaking = true;
      return true;
    }
    return null;
  }

  state.belowTicks += 1;
  if (state.speaking && state.belowTicks * SPEAKING_TICK_MS >= SPEAKING_OFF_MS) {
    state.speaking = false;
    return false;
  }
  return null;
}

interface PeerRuntime {
  key: PeerKey;
  pc: RTCPeerConnection;
  /** Whether this engine is the polite side of negotiation with this peer. See `isPolite`. */
  polite: boolean;
  makingOffer: boolean;
  candidateQueue: RTCIceCandidateInit[];
  restartsAttempted: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  gainNode: GainNode | null;
  audioEl: AudioElementLike | null;
  connectionState: RTCPeerConnectionState;
  speakingState: SpeakingState;
  /**
   * Every description-setting operation for this peer (an outgoing
   * negotiate() and an incoming handleDescription()) runs through this
   * queue, one at a time. Without it, an outgoing offer's createOffer()
   * and an incoming offer's rollback+setRemoteDescription can interleave
   * on the same RTCPeerConnection: the outgoing side's setLocalDescription
   * then fails ("wrong state: have-remote-offer") after the state moved
   * out from under it, and that peer connection never recovers, since
   * nothing schedules a retry. Serializing removes the interleaving
   * entirely: the signalingState a queued step reads is always still
   * current, because the previous step is fully finished by the time it
   * runs.
   */
  signalingQueue: Promise<void>;
}

export function createVoiceEngine(deps: VoiceEngineDeps): VoiceEngine {
  const nowFn = deps.now ?? (() => Date.now());
  const setTimeoutFn = deps.setTimeout ?? setTimeout;
  const clearTimeoutFn = deps.clearTimeout ?? clearTimeout;

  const selfKey: PeerKey = { userId: deps.selfUserId, deviceId: deps.selfDeviceId };

  const emitters: { [K in keyof VoiceEngineEventMap]: Emitter<VoiceEngineEventMap[K]> } = {
    peers: new Emitter(),
    localSpeaking: new Emitter(),
    error: new Emitter(),
  };

  const peers = new Map<string, PeerRuntime>();
  /** Peer ids currently being created by `ensurePeer`, so a concurrent caller joins the same creation instead of starting a second one. */
  const pendingEnsurePeer = new Map<string, Promise<PeerRuntime>>();
  const userVolumes = new Map<string, number>();

  let currentGuildId: string | null = null;
  let currentChannelId: string | null = null;
  let signalTransport: SignalTransport | null = null;
  let localStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let localSourceNode: MediaStreamAudioSourceNode | null = null;
  const localSpeakingState = createSpeakingState();
  let speakingTimer: ReturnType<typeof setTimeout> | null = null;
  let turnCache: { iceServers: RTCIceServer[]; expiresAt: number } | null = null;
  // Resolves the moment our own VOICE_JOIN is confirmed by the server (its
  // VOICE_STATE_UPDATE echo for our own peer), so `join()` never starts
  // signaling before the server has actually registered us in the
  // channel. Without this, an offer sent right after VOICE_JOIN can beat
  // VOICE_JOIN's own processing and come back NOT_IN_VOICE.
  let joinConfirmed: (() => void) | null = null;
  let muted = false;
  let deafened = false;
  let inputDeviceId: string | undefined;
  let outputDeviceId: string | undefined;

  function emitError(error: VoiceEngineErrorEvent): void {
    emitters.error.emit(error);
  }

  function snapshotPeers(): VoicePeerState[] {
    return [...peers.values()].map((runtime) => ({
      userId: runtime.key.userId,
      deviceId: runtime.key.deviceId,
      connectionState: runtime.connectionState,
      speaking: runtime.speakingState.speaking,
    }));
  }

  function emitPeers(): void {
    emitters.peers.emit(snapshotPeers());
  }

  // ---- TURN credentials -----------------------------------------------------

  async function getIceServers(): Promise<RTCIceServer[]> {
    const now = nowFn();
    if (turnCache && turnCache.expiresAt - TURN_REFRESH_SKEW_MS > now) {
      return turnCache.iceServers;
    }
    const result = await deps.getTurnCredentials();
    turnCache = { iceServers: result.iceServers, expiresAt: now + result.ttlSeconds * 1_000 };
    return turnCache.iceServers;
  }

  // ---- local mute/deafen ------------------------------------------------------

  function applyMuteToLocalTrack(): void {
    if (!localStream) {
      return;
    }
    const enabled = !muted && !deafened;
    for (const track of localStream.getAudioTracks()) {
      track.enabled = enabled;
    }
  }

  // ---- speaking detection (one shared timer for the whole call) ---------------

  function setupLocalSpeakingSource(): void {
    if (!audioContext || !localStream) {
      return;
    }
    const source = audioContext.createMediaStreamSource(localStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    // Not connected onward: this branch exists only to read volume, never
    // to make the user hear themselves.
    source.connect(analyser);
    localSourceNode = source;
    localSpeakingState.analyser = analyser;
    localSpeakingState.buffer = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    localSpeakingState.speaking = false;
    localSpeakingState.belowTicks = 0;
  }

  function speakingTick(): void {
    speakingTimer = null;

    const localChange = sampleSpeaking(localSpeakingState);
    if (localChange !== null) {
      emitters.localSpeaking.emit(localChange);
    }

    let peersChanged = false;
    for (const runtime of peers.values()) {
      const change = sampleSpeaking(runtime.speakingState);
      if (change !== null) {
        peersChanged = true;
      }
    }
    if (peersChanged) {
      emitPeers();
    }

    if (currentChannelId !== null) {
      speakingTimer = setTimeoutFn(speakingTick, SPEAKING_TICK_MS);
    }
  }

  function ensureSpeakingTimer(): void {
    if (speakingTimer || currentChannelId === null) {
      return;
    }
    speakingTimer = setTimeoutFn(speakingTick, SPEAKING_TICK_MS);
  }

  // ---- remote audio graph ------------------------------------------------------

  function makeAudioElement(): AudioElementLike | null {
    if (deps.createAudioElement) {
      return deps.createAudioElement();
    }
    if (typeof document === "undefined") {
      return null;
    }
    return document.createElement("audio") as unknown as AudioElementLike;
  }

  function attachRemoteStream(runtime: PeerRuntime, stream: MediaStream): void {
    if (audioContext && masterGain) {
      const source = audioContext.createMediaStreamSource(stream);
      const gain = audioContext.createGain();
      gain.gain.value = userVolumes.get(runtime.key.userId) ?? 1;
      source.connect(gain);
      gain.connect(masterGain);

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      runtime.sourceNode = source;
      runtime.gainNode = gain;
      runtime.speakingState.analyser = analyser;
      runtime.speakingState.buffer = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    }

    // Chromium is known to output silence from Web Audio for a
    // MediaStream that is never attached to a media element, even when
    // the audio graph above is wired correctly. A muted <audio> element
    // works around this; the audible path is the Web Audio graph, not
    // this element.
    const audioEl = makeAudioElement();
    if (audioEl) {
      audioEl.srcObject = stream;
      audioEl.muted = true;
      if (outputDeviceId) {
        applySinkId(audioEl, outputDeviceId);
      }
      runtime.audioEl = audioEl;
    }
  }

  function applySinkId(audioEl: AudioElementLike, deviceId: string): void {
    if (!audioEl.setSinkId) {
      emitError({
        kind: "output-device-unsupported",
        message: "The browser does not support output device selection.",
      });
      return;
    }
    audioEl.setSinkId(deviceId).catch(() => {
      emitError({
        kind: "output-device-unsupported",
        message: "The browser could not switch the output device.",
      });
    });
  }

  // ---- perfect negotiation ------------------------------------------------------

  /**
   * Run one signaling step (an outgoing negotiate or an incoming
   * description) after every step already queued for this peer has
   * finished. See the `signalingQueue` field for why this matters: it is
   * what keeps an outgoing offer and an incoming offer from touching the
   * same RTCPeerConnection at once.
   */
  function enqueueSignaling(runtime: PeerRuntime, step: () => Promise<void>): Promise<void> {
    const run = runtime.signalingQueue.then(step, step);
    // Keep the chain alive even after a step throws, so the NEXT queued
    // step still runs; each step already handles its own errors, this
    // just stops one failure from wedging every later signal for good.
    runtime.signalingQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function negotiate(runtime: PeerRuntime): Promise<void> {
    return enqueueSignaling(runtime, () => negotiateNow(runtime));
  }

  async function negotiateNow(runtime: PeerRuntime): Promise<void> {
    if (runtime.makingOffer || runtime.pc.signalingState !== "stable") {
      // Either we are already sending an offer, or an incoming
      // description moved us out of "stable" while this step waited its
      // turn in the queue: an offer would be rejected in either case.
      return;
    }
    try {
      runtime.makingOffer = true;
      const offer = await runtime.pc.createOffer();
      const patched = applyOpusFec(offer);
      await runtime.pc.setLocalDescription(patched);
      signalTransport?.send(runtime.key, { kind: "description", description: patched });
    } catch {
      // A dropped offer is not fatal: `onnegotiationneeded` or the next
      // membership change tries again.
    } finally {
      runtime.makingOffer = false;
    }
  }

  async function flushCandidateQueue(runtime: PeerRuntime): Promise<void> {
    const queued = runtime.candidateQueue;
    runtime.candidateQueue = [];
    for (const candidate of queued) {
      try {
        await runtime.pc.addIceCandidate(candidate);
      } catch {
        // A stale queued candidate is not fatal: ICE keeps trying with
        // whatever candidates did apply.
      }
    }
  }

  async function handleDescription(runtime: PeerRuntime, description: RTCSessionDescriptionInit): Promise<void> {
    return enqueueSignaling(runtime, () => handleDescriptionNow(runtime, description));
  }

  async function handleDescriptionNow(runtime: PeerRuntime, description: RTCSessionDescriptionInit): Promise<void> {
    if (description.type === "offer") {
      const offerCollision = runtime.makingOffer || runtime.pc.signalingState !== "stable";
      const shouldIgnore = !runtime.polite && offerCollision;
      if (shouldIgnore) {
        return;
      }
      if (offerCollision) {
        // The polite side yields: roll back its own in-flight offer
        // before accepting the peer's, per the perfect-negotiation
        // pattern (see engine.ts negotiate()/handleDescription()).
        await runtime.pc.setLocalDescription({ type: "rollback" });
      }
      await runtime.pc.setRemoteDescription(description);
      await flushCandidateQueue(runtime);
      const answer = await runtime.pc.createAnswer();
      const patched = applyOpusFec(answer);
      await runtime.pc.setLocalDescription(patched);
      signalTransport?.send(runtime.key, { kind: "description", description: patched });
    } else {
      await runtime.pc.setRemoteDescription(description);
      await flushCandidateQueue(runtime);
    }
  }

  async function handleSignal(from: PeerKey, payload: SignalPayload): Promise<void> {
    if (currentChannelId === null) {
      return;
    }
    const id = keyOf(from);
    let runtime = peers.get(id);
    if (!runtime) {
      // A later peer's offer (or an early candidate) arrives before we
      // learned about them from VOICE_STATE_UPDATE: create the
      // connection now, lazily, rather than wait.
      runtime = await ensurePeer(from);
    }

    if (payload.kind === "description") {
      await handleDescription(runtime, payload.description);
    } else if (payload.kind === "candidate") {
      if (runtime.pc.remoteDescription) {
        try {
          await runtime.pc.addIceCandidate(payload.candidate);
        } catch {
          // A candidate WebRTC rejects outright is not fatal.
        }
      } else {
        runtime.candidateQueue.push(payload.candidate);
      }
    }
    // `kind: "media"` (camera/screen stream announcements) is reserved
    // for a later milestone; this pass is audio-only.
  }

  // ---- ICE recovery ------------------------------------------------------------

  function closePeer(runtime: PeerRuntime): void {
    if (runtime.restartTimer) {
      clearTimeoutFn(runtime.restartTimer);
      runtime.restartTimer = null;
    }
    runtime.pc.onicecandidate = null;
    runtime.pc.ontrack = null;
    runtime.pc.onconnectionstatechange = null;
    runtime.pc.onnegotiationneeded = null;
    runtime.pc.close();
    if (runtime.sourceNode) {
      runtime.sourceNode.disconnect();
    }
    if (runtime.gainNode) {
      runtime.gainNode.disconnect();
    }
    if (runtime.audioEl) {
      runtime.audioEl.srcObject = null;
    }
  }

  async function rebuildPeer(runtime: PeerRuntime): Promise<void> {
    const key = runtime.key;
    closePeer(runtime);
    peers.delete(keyOf(key));
    const fresh = await ensurePeer(key);
    // The impolite side offers first on a rebuild, the same rule that
    // decides who restarts ICE below: it keeps one side in charge of
    // recovery instead of both sides racing to renegotiate at once.
    if (!fresh.polite) {
      await negotiate(fresh);
    }
    emitPeers();
  }

  function attemptIceRestart(runtime: PeerRuntime): void {
    if (runtime.restartsAttempted >= MAX_ICE_RESTARTS) {
      void rebuildPeer(runtime);
      return;
    }
    const delay = ICE_RESTART_BACKOFFS_MS[runtime.restartsAttempted]!;
    runtime.restartsAttempted += 1;
    runtime.restartTimer = setTimeoutFn(() => {
      runtime.restartTimer = null;
      if (runtime.pc.connectionState !== "failed") {
        return; // Recovered on its own; nothing more to do.
      }
      try {
        runtime.pc.restartIce();
      } catch {
        // The next connectionstatechange (still "failed") drives the next attempt.
      }
    }, delay);
  }

  function handlePeerFailed(runtime: PeerRuntime): void {
    // Only the impolite side drives recovery, so the two sides never
    // restart ICE against each other at the same time.
    if (runtime.polite) {
      return;
    }
    attemptIceRestart(runtime);
  }

  // ---- peer connection lifecycle ------------------------------------------------

  async function ensurePeer(key: PeerKey): Promise<PeerRuntime> {
    const id = keyOf(key);
    const existing = peers.get(id);
    if (existing) {
      return existing;
    }

    // Two callers can race to create the same peer: the eager "later
    // peer" path from onPeerVoiceState, and handleSignal reacting to
    // their offer or an early candidate. Both call ensurePeer before the
    // first one has finished (getIceServers() below is async), so the
    // check above alone is not enough. Share one in-flight creation per
    // peer id, so a racing caller gets the SAME runtime instead of a
    // second, orphaned RTCPeerConnection that never sees the signal
    // traffic meant for the first one.
    const pending = pendingEnsurePeer.get(id);
    if (pending) {
      return pending;
    }

    const creating = (async (): Promise<PeerRuntime> => {
      const iceServers = await getIceServers();
      const pc = deps.createPeerConnection({ iceServers });
      const runtime: PeerRuntime = {
        key,
        pc,
        polite: isPolite(selfKey, key),
        makingOffer: false,
        candidateQueue: [],
        restartsAttempted: 0,
        restartTimer: null,
        sourceNode: null,
        gainNode: null,
        audioEl: null,
        connectionState: pc.connectionState,
        speakingState: createSpeakingState(),
        signalingQueue: Promise.resolve(),
      };
      peers.set(id, runtime);

      if (localStream) {
        for (const track of localStream.getTracks()) {
          const sender = pc.addTrack(track, localStream);
          if (track.kind === "audio") {
            void capOpusBitrate(sender, AUDIO_MAX_BITRATE_BPS).catch(() => {
              // Not every fake/browser supports setParameters(); the bitrate cap is best-effort.
            });
          }
        }
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          signalTransport?.send(key, { kind: "candidate", candidate: event.candidate.toJSON() });
        }
      };
      pc.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream(event.track ? [event.track] : []);
        attachRemoteStream(runtime, stream);
      };
      pc.onconnectionstatechange = () => {
        runtime.connectionState = pc.connectionState;
        emitPeers();
        if (pc.connectionState === "failed") {
          handlePeerFailed(runtime);
        }
      };
      pc.onnegotiationneeded = () => {
        void negotiate(runtime);
      };

      emitPeers();
      return runtime;
    })();

    pendingEnsurePeer.set(id, creating);
    try {
      return await creating;
    } finally {
      pendingEnsurePeer.delete(id);
    }
  }

  // ---- public: membership from VOICE_STATE_UPDATE ------------------------------

  function onPeerVoiceState(update: VoiceStateJson): void {
    if (update.userId === selfKey.userId && update.deviceId === selfKey.deviceId) {
      if (update.channelId === null) {
        // The server removed our own voice state (a VOICE_LEAVE echo, a
        // move to another device, or a kick): clean up the same way
        // `leave()` does, and let the caller's UI react.
        void teardown(false);
      } else if (update.channelId === currentChannelId && joinConfirmed) {
        joinConfirmed();
        joinConfirmed = null;
      }
      return;
    }

    const key: PeerKey = { userId: update.userId, deviceId: update.deviceId };
    const id = keyOf(key);

    if (update.channelId === null || update.channelId !== currentChannelId) {
      const runtime = peers.get(id);
      if (runtime) {
        closePeer(runtime);
        peers.delete(id);
        emitPeers();
      }
      return;
    }

    if (currentChannelId !== null && !peers.has(id)) {
      // A peer we did not know about is in our channel. We are not the
      // newcomer here, so we only prepare the connection and wait for
      // their offer, rather than call createOffer ourselves.
      void ensurePeer(key);
    }
  }

  function handleVoiceError(payload: { code: VoiceErrorCode; message: string }): void {
    emitError({ kind: "voice-error", message: payload.message, code: payload.code });
  }

  // ---- public: join/leave ------------------------------------------------------

  async function teardown(shouldSendLeave: boolean): Promise<void> {
    const wasActive = currentChannelId !== null || peers.size > 0 || localStream !== null;
    if (!wasActive) {
      return;
    }

    if (speakingTimer) {
      clearTimeoutFn(speakingTimer);
      speakingTimer = null;
    }

    for (const runtime of peers.values()) {
      closePeer(runtime);
    }
    peers.clear();

    if (localSourceNode) {
      localSourceNode.disconnect();
      localSourceNode = null;
    }
    localSpeakingState.analyser = null;
    localSpeakingState.buffer = null;
    localSpeakingState.speaking = false;
    localSpeakingState.belowTicks = 0;

    if (localStream) {
      for (const track of localStream.getTracks()) {
        track.stop();
      }
      localStream = null;
    }

    if (masterGain) {
      masterGain.disconnect();
      masterGain = null;
    }
    if (audioContext) {
      await audioContext.close();
      audioContext = null;
    }

    if (signalTransport) {
      signalTransport.close?.();
      signalTransport = null;
    }

    currentChannelId = null;
    currentGuildId = null;

    if (shouldSendLeave) {
      deps.sendVoiceLeave();
    }
    emitPeers();
  }

  async function join(guildId: string, channelId: string): Promise<void> {
    if (currentChannelId !== null) {
      // Switching channels: clean up the old call locally. The server
      // replaces our voice state on the next VOICE_JOIN by itself (see
      // docs/concepts/voice.md), so this does not send VOICE_LEAVE.
      await teardown(false);
    }

    currentGuildId = guildId;
    currentChannelId = channelId;

    try {
      localStream = await deps.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(inputDeviceId ? { deviceId: inputDeviceId } : {}),
        },
      });
    } catch {
      currentChannelId = null;
      currentGuildId = null;
      emitError({
        kind: "mic-permission-denied",
        message: "The browser did not allow use of the microphone.",
      });
      // `join()` resolves rather than rejects even on mic denial: the
      // caller learns about the failure from the "error" event and finds
      // the engine already back in a clean, not-in-call state.
      return;
    }

    applyMuteToLocalTrack();
    audioContext = deps.createAudioContext();
    masterGain = audioContext.createGain();
    masterGain.gain.value = deafened ? 0 : 1;
    masterGain.connect(audioContext.destination);
    setupLocalSpeakingSource();

    signalTransport = deps.createSignalTransport(channelId);
    signalTransport.onSignal((from, payload) => {
      void handleSignal(from, payload);
    });

    deps.sendVoiceJoin(channelId, muted, deafened);

    // Wait for the server's own echo of our join (its VOICE_STATE_UPDATE
    // for our own peer) before sending any signal. Sending an offer
    // before the server has processed VOICE_JOIN can arrive first and
    // come back NOT_IN_VOICE (see onPeerVoiceState above). A short
    // timeout keeps this from hanging forever if that echo is ever lost.
    await new Promise<void>((resolve) => {
      joinConfirmed = resolve;
      setTimeoutFn(() => {
        if (joinConfirmed) {
          joinConfirmed = null;
          resolve();
        }
      }, JOIN_CONFIRM_TIMEOUT_MS);
    });

    const initialPeers = deps.getInitialPeers(channelId);
    for (const peerKey of initialPeers) {
      const runtime = await ensurePeer(peerKey);
      // We are the newcomer: we offer to every peer already here.
      await negotiate(runtime);
      // Observed on Chromium: adding the same local track as a sender to
      // a second RTCPeerConnection right after the first one can leave
      // that second sender producing no encoded audio at all, even
      // though the connection itself reaches "connected" normally. A
      // short pause between peers avoids it. This only affects the
      // newcomer's own catch-up loop (one peer at a time, already), not
      // ordinary calls with two people, so the added join time is small.
      await new Promise<void>((resolve) => setTimeoutFn(resolve, NEWCOMER_TRACK_SHARE_DELAY_MS));
    }

    ensureSpeakingTimer();
  }

  async function leave(): Promise<void> {
    await teardown(true);
  }

  // ---- public: mute/deafen/devices/volume ---------------------------------------

  function setMute(nextMuted: boolean): void {
    muted = nextMuted;
    applyMuteToLocalTrack();
    deps.sendVoiceState({ selfMute: muted });
  }

  function setDeafen(nextDeafened: boolean): void {
    deafened = nextDeafened;
    if (masterGain) {
      masterGain.gain.value = deafened ? 0 : 1;
    }
    // Un-deafening restores whatever `setMute` last set; it does not force an unmute.
    applyMuteToLocalTrack();
    deps.sendVoiceState({ selfDeaf: deafened });
  }

  function setInputDevice(deviceId: string): void {
    inputDeviceId = deviceId;
    if (currentChannelId === null) {
      return;
    }
    void (async () => {
      let newStream: MediaStream;
      try {
        newStream = await deps.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, deviceId },
        });
      } catch {
        emitError({
          kind: "mic-permission-denied",
          message: "The browser did not allow use of the microphone.",
        });
        return;
      }
      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) {
        return;
      }
      newTrack.enabled = !muted && !deafened;
      const oldStream = localStream;
      localStream = newStream;
      for (const runtime of peers.values()) {
        const sender = runtime.pc.getSenders().find((s) => s.track?.kind === "audio");
        if (sender) {
          await sender.replaceTrack(newTrack);
        }
      }
      if (audioContext) {
        if (localSourceNode) {
          localSourceNode.disconnect();
        }
        setupLocalSpeakingSource();
      }
      if (oldStream) {
        for (const track of oldStream.getTracks()) {
          track.stop();
        }
      }
    })();
  }

  async function setOutputDevice(deviceId: string): Promise<void> {
    outputDeviceId = deviceId;
    for (const runtime of peers.values()) {
      if (runtime.audioEl) {
        applySinkId(runtime.audioEl, deviceId);
      }
    }
  }

  function setUserVolume(userId: string, volume: number): void {
    const clamped = Math.min(2, Math.max(0, volume));
    userVolumes.set(userId, clamped);
    for (const runtime of peers.values()) {
      if (runtime.key.userId === userId && runtime.gainNode) {
        runtime.gainNode.gain.value = clamped;
      }
    }
  }

  async function getDebugStats(): Promise<VoiceDebugPeerStats[]> {
    const results: VoiceDebugPeerStats[] = [];
    for (const runtime of peers.values()) {
      const report = await runtime.pc.getStats();
      const statsById = new Map<string, RTCStats>();
      report.forEach((stat) => {
        statsById.set(stat.id, stat);
      });

      let selectedPairId: string | null = null;
      let selectedCandidateType: string | null = null;
      let inboundBytesReceived = 0;
      let outboundBytesSent = 0;

      for (const stat of statsById.values()) {
        const loose = stat as unknown as Record<string, unknown>;
        if (stat.type === "transport" && typeof loose.selectedCandidatePairId === "string") {
          selectedPairId = loose.selectedCandidatePairId;
        }
      }
      for (const stat of statsById.values()) {
        const loose = stat as unknown as Record<string, unknown>;
        const isSelectedPair =
          stat.type === "candidate-pair" && (stat.id === selectedPairId || (selectedPairId === null && loose.nominated === true));
        if (isSelectedPair) {
          const localCandidateId = loose.localCandidateId;
          const localCandidate = typeof localCandidateId === "string" ? statsById.get(localCandidateId) : undefined;
          const candidateType = (localCandidate as unknown as Record<string, unknown> | undefined)?.candidateType;
          if (typeof candidateType === "string") {
            selectedCandidateType = candidateType;
          }
        }
        if (stat.type === "inbound-rtp" && loose.kind === "audio") {
          inboundBytesReceived += typeof loose.bytesReceived === "number" ? loose.bytesReceived : 0;
        }
        if (stat.type === "outbound-rtp" && loose.kind === "audio") {
          outboundBytesSent += typeof loose.bytesSent === "number" ? loose.bytesSent : 0;
        }
      }

      results.push({
        userId: runtime.key.userId,
        deviceId: runtime.key.deviceId,
        connectionState: runtime.connectionState,
        selectedCandidateType,
        inboundBytesReceived,
        outboundBytesSent,
      });
    }
    return results;
  }

  function isLocalTrackEnabled(): boolean | null {
    const track = localStream?.getAudioTracks()[0];
    return track ? track.enabled : null;
  }

  return {
    join,
    leave,
    setMute,
    setDeafen,
    setInputDevice,
    setOutputDevice,
    setUserVolume,
    onPeerVoiceState,
    handleVoiceError,
    getDebugStats,
    isLocalTrackEnabled,
    on(event, handler) {
      return emitters[event].on(handler);
    },
    get peers() {
      return snapshotPeers();
    },
    get channelId() {
      return currentChannelId;
    },
    get guildId() {
      return currentGuildId;
    },
  };
}
