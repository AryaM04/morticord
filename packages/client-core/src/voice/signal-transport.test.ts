// Tests of the Olm signal transport: the binding of each signal to the
// channel, the call ids and the peer device, and the order of sends. The
// last test sends signals through the real crypto layer (vodozemac WASM and
// the fake server).
import { beforeAll, describe, expect, it } from "vitest";
import { FakeServer, initWasmForTests, newClient } from "../crypto/test/fake-server.js";
import {
  VOICE_SIGNAL_TYPE,
  createOlmSignalTransport,
  type PeerKey,
  type PeerVoiceState,
  type SignalCrypto,
  type SignalPayload,
} from "./signal-transport.js";

type ToDeviceEvent = { type: string; content: Record<string, unknown>; sender: PeerKey };

function fakeCrypto() {
  const handlers = new Set<(event: ToDeviceEvent) => void>();
  const sent: Array<{ target: PeerKey; type: string; content: Record<string, unknown> }> = [];
  const crypto: SignalCrypto = {
    async sendToDevice(target, type, content) {
      sent.push({ target, type, content });
    },
    onToDevice(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
  return {
    crypto,
    sent,
    deliver(event: ToDeviceEvent) {
      for (const handler of handlers) {
        handler(event);
      }
    },
  };
}

const offer: SignalPayload = { kind: "description", description: { type: "offer", sdp: "v=0" } };
const bob: PeerKey = { userId: "2", deviceId: "B1" };

function setup(states: Record<string, PeerVoiceState>) {
  const fake = fakeCrypto();
  const transport = createOlmSignalTransport({
    channelId: "50",
    callId: "call-a",
    crypto: fake.crypto,
    peerState: (userId) => states[userId] ?? null,
  });
  const received: Array<{ from: PeerKey; payload: SignalPayload }> = [];
  transport.onSignal((from, payload) => received.push({ from, payload }));
  return { fake, transport, received };
}

function signal(sender: PeerKey, content: Record<string, unknown>): ToDeviceEvent {
  return { type: VOICE_SIGNAL_TYPE, sender, content: { channelId: "50", callId: "call-b", targetCallId: "call-a", payload: offer, ...content } };
}

describe("Olm signal transport", () => {
  it("binds the channel and both call ids into each signal, and keeps the order of sends", async () => {
    const { fake, transport } = setup({ "2": { deviceId: "B1", callId: "call-b" } });
    transport.send(bob, offer);
    transport.send(bob, { kind: "candidate", candidate: { candidate: "c1" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.sent.map((entry) => entry.type)).toEqual([VOICE_SIGNAL_TYPE, VOICE_SIGNAL_TYPE]);
    expect(fake.sent[0]!.target).toEqual(bob);
    expect(fake.sent[0]!.content).toEqual({ channelId: "50", callId: "call-a", targetCallId: "call-b", payload: offer });
    expect((fake.sent[1]!.content.payload as SignalPayload).kind).toBe("candidate");
  });

  it("does not send to a device that is not the device in the voice state", async () => {
    const { fake, transport } = setup({ "2": { deviceId: "B2", callId: "call-b" } });
    transport.send(bob, offer);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.sent).toEqual([]);
  });

  it("accepts a signal from the expected peer device with the current call ids", () => {
    const { fake, received } = setup({ "2": { deviceId: "B1", callId: "call-b" } });
    fake.deliver(signal(bob, {}));
    expect(received).toEqual([{ from: bob, payload: offer }]);
  });

  it("drops a signal with a forged sender device", () => {
    const { fake, received } = setup({ "2": { deviceId: "B1", callId: "call-b" } });
    // A different device of the same user, which is not in the call.
    fake.deliver(signal({ userId: "2", deviceId: "B2" }, {}));
    // A user who is not in the call at all.
    fake.deliver(signal({ userId: "3", deviceId: "C1" }, {}));
    expect(received).toEqual([]);
  });

  it("drops a signal with a stale call id of the sender or of the receiver", () => {
    const { fake, received } = setup({ "2": { deviceId: "B1", callId: "call-b" } });
    fake.deliver(signal(bob, { callId: "old-call-b" }));
    fake.deliver(signal(bob, { targetCallId: "old-call-a" }));
    fake.deliver(signal(bob, { channelId: "51" }));
    expect(received).toEqual([]);
  });

  it("drops a signal when the peer state has no call id, a bad payload, or a different type", () => {
    const noCallId = setup({ "2": { deviceId: "B1" } });
    noCallId.fake.deliver(signal(bob, {}));
    expect(noCallId.received).toEqual([]);

    const { fake, received } = setup({ "2": { deviceId: "B1", callId: "call-b" } });
    fake.deliver(signal(bob, { payload: { kind: "description", description: "x" } }));
    fake.deliver({ ...signal(bob, {}), type: "debug.ping" });
    expect(received).toEqual([]);
  });

  it("stops after close", () => {
    const { fake, transport, received } = setup({ "2": { deviceId: "B1", callId: "call-b" } });
    transport.close?.();
    fake.deliver(signal(bob, {}));
    expect(received).toEqual([]);
  });
});

describe("Olm signal transport with the real crypto layer", () => {
  beforeAll(() => {
    initWasmForTests();
  });

  it("carries signals between two devices in order, and the receiver sees the verified sender", async () => {
    const server = new FakeServer();
    const alice = newClient("1", "A1");
    const bobClient = newClient("2", "B1");
    const aliceHandle = await server.start(alice);
    const bobHandle = await server.start(bobClient);

    const states: Record<string, PeerVoiceState> = {
      "1": { deviceId: "A1", callId: "call-a" },
      "2": { deviceId: "B1", callId: "call-b" },
    };
    const cryptoOf = (handle: typeof aliceHandle): SignalCrypto => ({
      async sendToDevice(target, type, content) {
        await handle.encryptToDevices([target], type, content, { live: true });
      },
      onToDevice: (handler) => handle.onToDevice(handler),
    });
    const aliceTransport = createOlmSignalTransport({ channelId: "50", callId: "call-a", crypto: cryptoOf(aliceHandle), peerState: (id) => states[id] ?? null });
    const bobTransport = createOlmSignalTransport({ channelId: "50", callId: "call-b", crypto: cryptoOf(bobHandle), peerState: (id) => states[id] ?? null });
    const received: Array<{ from: PeerKey; payload: SignalPayload }> = [];
    bobTransport.onSignal((from, payload) => received.push({ from, payload }));

    aliceTransport.send(bob, offer);
    for (let i = 0; i < 5; i += 1) {
      aliceTransport.send(bob, { kind: "candidate", candidate: { candidate: `c${i}` } });
    }
    await expect.poll(() => received.length).toBe(6);
    await bobHandle.whenIdle();
    expect(received[0]).toEqual({ from: { userId: "1", deviceId: "A1" }, payload: offer });
    expect(received.slice(1).map((entry) => (entry.payload as { candidate: { candidate: string } }).candidate.candidate)).toEqual([
      "c0",
      "c1",
      "c2",
      "c3",
      "c4",
    ]);

    // After Alice joins again with a new call id, a queued signal of the old call is dropped.
    states["1"] = { deviceId: "A1", callId: "call-a2" };
    const queued = server.queue.length;
    aliceTransport.send(bob, offer);
    await expect.poll(() => server.queue.length).toBeGreaterThan(queued);
    await bobHandle.whenIdle();
    expect(received).toHaveLength(6);
    aliceTransport.close?.();
    bobTransport.close?.();
    server.stop(alice);
    server.stop(bobClient);
  });
});
