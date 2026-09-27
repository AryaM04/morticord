// The one message store for this tab: channel windows, decoded payloads,
// pending sends, typing and read state. It uses the plaintext codec until
// milestone M6 swaps in the encrypted one.
import { createMessagesStore, plainCodec } from "@discord-clone/client-core";
import { session } from "./session.js";
import { gatewaySend } from "./realtime.js";

export const messagesStore = createMessagesStore({
  api: session.apiClient,
  codec: plainCodec,
  send: gatewaySend,
});
