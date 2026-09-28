// The voice call for this tab: join, leave, mute, deafen, and the state a
// voice status panel reads. The engine itself lives in
// `@discord-clone/client-core/voice` and is loaded only on the first
// join, per the resource rule in CLAUDE.md (load heavy parts, such as
// voice, only when needed).
import { createStore } from "zustand/vanilla";
import { GatewayOpcode } from "@discord-clone/shared";
import { getTurnCredentials } from "@discord-clone/client-core";
import type {
  VoiceDebugPeerStats,
  VoiceEngine,
  VoiceEngineErrorEvent,
  VoicePeerState,
} from "@discord-clone/client-core/voice";
import { session } from "./session.js";
import { gatewaySend, realtimeStore, subscribeDispatch } from "./realtime.js";

export type VoiceConnectionState = "idle" | "connecting" | "connected";

/** The worst of every peer's connection state, in plain words, for the status panel. */
export type VoiceQuality = "good" | "poor" | "connecting" | "lost";

export interface VoiceUiState {
  status: VoiceConnectionState;
  guildId: string | null;
  channelId: string | null;
  muted: boolean;
  deafened: boolean;
  peers: VoicePeerState[];
  localSpeaking: boolean;
  quality: VoiceQuality;
  /** The last error, in plain words fit for direct display. Cleared on the next successful join. */
  errorMessage: string | null;
  /** Whether the local camera is on right now. */
  cameraOn: boolean;
  /** Whether local screen sharing is on right now. */
  screenOn: boolean;
  /** The local camera's stream, for the mirrored preview tile, or null when the camera is off. */
  localCameraStream: MediaStream | null;
  /** The local screen-share stream, for the preview tile, or null when not sharing. */
  localScreenStream: MediaStream | null;
}

function initialVoiceUiState(): VoiceUiState {
  return {
    status: "idle",
    guildId: null,
    channelId: null,
    muted: false,
    deafened: false,
    peers: [],
    localSpeaking: false,
    quality: "connecting",
    errorMessage: null,
    cameraOn: false,
    screenOn: false,
    localCameraStream: null,
    localScreenStream: null,
  };
}

/** True when this browser supports the camera at all. Used to disable the camera button with a clear reason. */
export const cameraSupported = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
/** True when this browser supports screen capture. Used to disable the screen button with a clear reason. */
export const screenShareSupported =
  typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia);

export const voiceStore = createStore<VoiceUiState>(() => initialVoiceUiState());

function describeError(error: VoiceEngineErrorEvent): string {
  switch (error.kind) {
    case "mic-permission-denied":
      return "The browser did not allow use of the microphone. Voice chat needs microphone access.";
    case "camera-permission-denied":
      return "The browser did not allow use of the camera.";
    case "screen-permission-denied":
      return "The browser did not allow screen capture.";
    case "output-device-unsupported":
      return "This browser cannot change the audio output device.";
    case "ice-failed":
      return "The connection to a voice peer failed.";
    case "voice-error":
    default:
      return error.message;
  }
}

function worstQuality(peers: VoicePeerState[]): VoiceQuality {
  if (peers.length === 0) {
    return "connecting";
  }
  let quality: VoiceQuality = "good";
  for (const peer of peers) {
    if (peer.connectionState === "failed" || peer.connectionState === "closed") {
      return "lost";
    }
    if (peer.connectionState === "disconnected") {
      quality = "poor";
    } else if (peer.connectionState !== "connected" && quality === "good") {
      quality = "connecting";
    }
  }
  return quality;
}

let engine: VoiceEngine | null = null;
let engineLoad: Promise<VoiceEngine> | null = null;

/**
 * True when the page's first URL of this tab carried `?forceRelay`, a
 * test-only flag that forces every peer connection to use the TURN
 * relay, never a direct or server-reflexive path. The voice end-to-end
 * test uses this to prove the relay path works on its own, without a
 * real NAT in the way. Read once at module load, not on every call:
 * joining a voice channel also does a client-side route change (see
 * ChannelColumn's onSelect), which rewrites the URL and would otherwise
 * drop the flag before the engine ever reads it.
 */
const forceRelay = new URLSearchParams(window.location.search).has("forceRelay");
function shouldForceRelay(): boolean {
  return forceRelay;
}

async function loadEngine(): Promise<VoiceEngine> {
  if (engine) {
    return engine;
  }
  if (!engineLoad) {
    engineLoad = (async () => {
      const mod = await import("@discord-clone/client-core/voice");
      const selfUserId = realtimeStore.getState().selfUserId;
      const selfDeviceId = session.store.getState().deviceId;
      if (!selfUserId || !selfDeviceId) {
        throw new Error("Cannot start voice before the session is ready.");
      }

      const created = mod.createVoiceEngine({
        getTurnCredentials: () => getTurnCredentials(session.apiClient),
        createSignalTransport: (channelId) =>
          mod.createGatewaySignalTransport({ channelId, send: gatewaySend, subscribe: subscribeDispatch }),
        sendVoiceJoin: (channelId, selfMute, selfDeaf) =>
          gatewaySend(GatewayOpcode.VOICE_JOIN, { channelId, selfMute, selfDeaf }),
        sendVoiceLeave: () => gatewaySend(GatewayOpcode.VOICE_LEAVE, {}),
        sendVoiceState: (patch) => gatewaySend(GatewayOpcode.VOICE_STATE, patch),
        getInitialPeers: (channelId) => {
          const states = realtimeStore.getState().voiceStatesByChannel[channelId] ?? {};
          return Object.values(states)
            .filter((state) => state.userId !== selfUserId)
            .map((state) => ({ userId: state.userId, deviceId: state.deviceId }));
        },
        selfUserId,
        selfDeviceId,
        createPeerConnection: (config) =>
          new RTCPeerConnection(shouldForceRelay() ? { ...config, iceTransportPolicy: "relay" } : config),
        getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
        getDisplayMedia: (constraints) => navigator.mediaDevices.getDisplayMedia(constraints),
        createAudioContext: () => new AudioContext(),
      });

      created.on("peers", (peers) => {
        voiceStore.setState({ peers, quality: worstQuality(peers) });
      });
      created.on("localSpeaking", (localSpeaking) => {
        voiceStore.setState({ localSpeaking });
      });
      created.on("error", (error) => {
        voiceStore.setState({ errorMessage: describeError(error) });
      });
      created.on("localMedia", ({ cameraOn, screenOn }) => {
        voiceStore.setState({
          cameraOn,
          screenOn,
          localCameraStream: created.localCameraStream,
          localScreenStream: created.localScreenStream,
        });
      });

      subscribeDispatch((event) => {
        if (event.t === "VOICE_STATE_UPDATE") {
          const update = event.d as Parameters<VoiceEngine["onPeerVoiceState"]>[0];
          created.onPeerVoiceState(update);
          // A leave dispatch for our own (userId, deviceId) means the
          // server removed us from voice (a kick, or a move to another
          // device). Reset the status panel straight from the dispatch,
          // rather than poll the engine's own state, since its teardown
          // runs asynchronously.
          if (update.channelId === null && update.userId === selfUserId && update.deviceId === selfDeviceId) {
            voiceStore.setState({
              status: "idle",
              guildId: null,
              channelId: null,
              peers: [],
              cameraOn: false,
              screenOn: false,
              localCameraStream: null,
              localScreenStream: null,
            });
          }
        } else if (event.t === "VOICE_ERROR") {
          created.handleVoiceError(event.d as Parameters<VoiceEngine["handleVoiceError"]>[0]);
        }
      });

      engine = created;
      return created;
    })();
  }
  return engineLoad;
}

/** Join a voice channel, leaving the current one first if there is one. */
export async function joinVoiceChannel(guildId: string, channelId: string): Promise<void> {
  voiceStore.setState({ status: "connecting", guildId, channelId, errorMessage: null });
  const voiceEngine = await loadEngine();
  await voiceEngine.join(guildId, channelId);
  if (voiceEngine.channelId === channelId) {
    voiceStore.setState({ status: "connected", muted: false, deafened: false });
  } else {
    // join() left the engine in a clean, not-in-call state (for example,
    // the microphone permission was denied). The "error" event already
    // carries the reason.
    voiceStore.setState({ status: "idle", guildId: null, channelId: null });
  }
}

export async function leaveVoice(): Promise<void> {
  if (!engine) {
    voiceStore.setState(initialVoiceUiState());
    return;
  }
  await engine.leave();
  voiceStore.setState(initialVoiceUiState());
}

export function toggleMute(): void {
  if (!engine) {
    return;
  }
  const nextMuted = !voiceStore.getState().muted;
  engine.setMute(nextMuted);
  voiceStore.setState({ muted: nextMuted });
}

// Remembers the mute state from right before a deafen, so the status
// panel's mute icon can be restored correctly when the user un-deafens.
let mutedBeforeDeafen = false;

export function toggleDeafen(): void {
  if (!engine) {
    return;
  }
  const nextDeafened = !voiceStore.getState().deafened;
  engine.setDeafen(nextDeafened);
  if (nextDeafened) {
    mutedBeforeDeafen = voiceStore.getState().muted;
    voiceStore.setState({ deafened: true, muted: true });
  } else {
    voiceStore.setState({ deafened: false, muted: mutedBeforeDeafen });
  }
}

/** Turn the local camera on or off. Does nothing when not in a call. */
export function toggleCamera(): void {
  if (!engine) {
    return;
  }
  void engine.setCamera(!voiceStore.getState().cameraOn);
}

/** Turn local screen sharing on or off. Does nothing when not in a call. */
export function toggleScreenShare(): void {
  if (!engine) {
    return;
  }
  void engine.setScreenShare(!voiceStore.getState().screenOn);
}

/** Debug stats for the e2e test and dev tooling. See `main.tsx` for where `window.__voiceDebug` is installed. */
export async function getVoiceDebugStats(): Promise<VoiceDebugPeerStats[]> {
  if (!engine) {
    return [];
  }
  return engine.getDebugStats();
}

/** Whether the local microphone track is enabled right now, or null when not in a call. */
export function isLocalVoiceTrackEnabled(): boolean | null {
  return engine ? engine.isLocalTrackEnabled() : null;
}

session.store.subscribe((state) => {
  if (state.status === "signedOut") {
    void leaveVoice();
  }
});
