// The one gateway connection and realtime store for this tab. It starts
// once the session signs in, and stops (and forgets everything) once it
// signs out. See docs/architecture.md section 7 and docs/concepts/gateway.md.
import { createStore } from "zustand/vanilla";
import {
  createGatewayClient,
  createRealtimeStore,
  type GatewayClient,
  type GatewayState,
} from "@discord-clone/client-core";
import { GatewayOpcode } from "@discord-clone/shared";
import { session } from "./session.js";

export const realtimeStore = createRealtimeStore();

export interface ConnectionState {
  state: GatewayState;
}

export const connectionStore = createStore<ConnectionState>(() => ({ state: "closed" }));

let client: GatewayClient | null = null;

function gatewayUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/gateway`;
}

function startGateway(deviceId: string): void {
  if (client) {
    return;
  }
  client = createGatewayClient({
    url: gatewayUrl(),
    deviceId,
    api: session.apiClient,
    onEvent: (event) => realtimeStore.getState().applyDispatch(event),
    onState: (state) => connectionStore.setState({ state }),
    onFatal: () => {
      void session.store.getState().logout();
    },
  });
}

function stopGateway(): void {
  client?.close();
  client = null;
  realtimeStore.getState().reset();
  connectionStore.setState({ state: "closed" });
}

/** Send PRESENCE_SET, or any other client-initiated gateway message. */
export function gatewaySend(op: number, d?: unknown): void {
  client?.send(op, d);
}

export function setPresence(status: "online" | "idle" | "dnd" | "invisible"): void {
  gatewaySend(GatewayOpcode.PRESENCE_SET, { status });
}

let previousStatus = session.store.getState().status;
session.store.subscribe((state) => {
  if (state.status === "signedIn" && state.deviceId && previousStatus !== "signedIn") {
    startGateway(state.deviceId);
  } else if (state.status === "signedOut" && previousStatus !== "signedOut") {
    stopGateway();
  }
  previousStatus = state.status;
});

const initial = session.store.getState();
if (initial.status === "signedIn" && initial.deviceId) {
  startGateway(initial.deviceId);
}
