// A request to show one message: the message list of that channel loads
// the page around it, scrolls to it and highlights it. Search results and
// reply previews use it.
import { createStore } from "zustand/vanilla";

export interface JumpRequest {
  channelId: string;
  eventId: string;
  /** A new number for each request, so the same message can show again. */
  nonce: number;
}

export const jumpStore = createStore<{ request: JumpRequest | null }>(() => ({ request: null }));

let nonce = 0;
export function requestJump(channelId: string, eventId: string): void {
  nonce += 1;
  jumpStore.setState({ request: { channelId, eventId, nonce } });
}
