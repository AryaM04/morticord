// React binding for the message store.
import { useStore } from "zustand";
import type { MessagesStore } from "@morticord/client-core";
import { messagesStore } from "./messages.js";

export function useMessages<T>(selector: (state: MessagesStore) => T): T {
  return useStore(messagesStore, selector);
}
