// Public surface of the voice subpackage. Import this only from
// "@discord-clone/client-core/voice", never from the main barrel: voice
// pulls in WebRTC- and Web Audio-shaped types, and the plan keeps it out
// of the main bundle until a call actually starts.
export {
  createVoiceEngine,
  comparePeerKeys,
  isPolite,
  AUDIO_MAX_BITRATE_BPS,
  SPEAKING_TICK_MS,
  SPEAKING_OFF_MS,
  SPEAKING_VOLUME_THRESHOLD,
  ICE_RESTART_BACKOFFS_MS,
  MAX_ICE_RESTARTS,
  TURN_REFRESH_SKEW_MS,
  JOIN_CONFIRM_TIMEOUT_MS,
  NEWCOMER_TRACK_SHARE_DELAY_MS,
  type VoiceEngine,
  type VoiceEngineDeps,
  type VoicePeerState,
  type VoiceEngineErrorEvent,
  type VoiceEngineErrorKind,
  type VoiceEngineEventMap,
  type AudioElementLike,
  type VoiceDebugPeerStats,
} from "./engine.js";

export {
  createGatewaySignalTransport,
  type SignalTransport,
  type PeerKey,
  type SignalPayload,
  type GatewayDispatchLike,
  type GatewaySignalTransportDeps,
} from "./signal-transport.js";

export { preferOpusFec, applyOpusFec, capOpusBitrate } from "./sdp.js";
