// The signal transport: the one module in the voice package that knows
// about the gateway. It sends and receives VOICE_SIGNAL messages for one
// voice channel. `VoiceEngine` never imports the gateway directly; it
// depends only on the `SignalTransport` interface below. This keeps a
// later milestone free to wrap this transport in Olm encryption without a
// change to the engine (see docs/concepts/voice.md).
import { GatewayOpcode } from "@discord-clone/shared";

/** One live voice session: one user, connected from one device. */
export interface PeerKey {
  userId: string;
  deviceId: string;
}

/** One signaling message carried over `VOICE_SIGNAL`. The server never reads this payload. */
export type SignalPayload =
  | { kind: "description"; description: RTCSessionDescriptionInit }
  | { kind: "candidate"; candidate: RTCIceCandidateInit }
  | { kind: "media"; streams: { camera?: string; screen?: string } };

export interface SignalTransport {
  send(target: PeerKey, payload: SignalPayload): void;
  /** Register a handler for an incoming signal. Returns a function that removes the handler. */
  onSignal(handler: (from: PeerKey, payload: SignalPayload) => void): () => void;
  /**
   * Stop listening for dispatches and release the underlying gateway
   * subscription. Optional on the interface, since a fake transport used
   * in a test may have nothing to release, but `createGatewaySignalTransport`
   * always provides one. The engine calls this once per call, on `leave()`.
   */
  close?(): void;
}

/** A generic gateway dispatch, decoded and validated by the caller. */
export interface GatewayDispatchLike {
  t: string;
  d: unknown;
}

export interface GatewaySignalTransportDeps {
  channelId: string;
  send(op: number, d?: unknown): void;
  /** Subscribe to every gateway dispatch. Returns a function that removes the subscription. */
  subscribe(listener: (dispatch: GatewayDispatchLike) => void): () => void;
}

interface VoiceSignalDispatchPayload {
  channelId: string;
  fromUserId: string;
  fromDeviceId: string;
  payload: unknown;
}

function isVoiceSignalDispatchPayload(value: unknown): value is VoiceSignalDispatchPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.channelId === "string" &&
    typeof record.fromUserId === "string" &&
    typeof record.fromDeviceId === "string"
  );
}

/**
 * Build a `SignalTransport` for one voice channel, backed by the gateway.
 * It sends `VOICE_SIGNAL` ops and listens for `VOICE_SIGNAL` dispatches
 * scoped to `deps.channelId`, and ignores every other dispatch.
 */
export function createGatewaySignalTransport(deps: GatewaySignalTransportDeps): SignalTransport {
  const handlers = new Set<(from: PeerKey, payload: SignalPayload) => void>();

  const unsubscribe = deps.subscribe((dispatch) => {
    if (dispatch.t !== "VOICE_SIGNAL") {
      return;
    }
    if (!isVoiceSignalDispatchPayload(dispatch.d)) {
      return;
    }
    if (dispatch.d.channelId !== deps.channelId) {
      return;
    }
    const from: PeerKey = { userId: dispatch.d.fromUserId, deviceId: dispatch.d.fromDeviceId };
    const payload = dispatch.d.payload as SignalPayload;
    for (const handler of handlers) {
      handler(from, payload);
    }
  });

  return {
    send(target, payload) {
      deps.send(GatewayOpcode.VOICE_SIGNAL, {
        channelId: deps.channelId,
        targetUserId: target.userId,
        targetDeviceId: target.deviceId,
        payload,
      });
    },
    onSignal(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    close() {
      handlers.clear();
      unsubscribe();
    },
  };
}
