// The local search index of this tab: it writes the decoded messages to
// the encrypted IndexedDB index of this user and device, and answers
// searches. Loaded with a dynamic import. See docs/concepts/search.md.
import {
  openLocalSearchIndex,
  type EditInput,
  type IndexInput,
  type IndexQuery,
  type IndexResult,
  type LocalSearchIndex,
} from "@discord-clone/client-core/search";
import { cryptoReady } from "./messages.js";
import { clearSearchQueue, type SearchChange } from "./search-queue.js";
import { session } from "./session.js";

let current: { name: string; index: Promise<LocalSearchIndex> } | null = null;

/** The index of the signed-in user and device. It waits for the crypto layer, which holds its keys. */
function getIndex(): Promise<LocalSearchIndex> {
  const { user, deviceId } = session.store.getState();
  if (!user || !deviceId) {
    return Promise.reject(new Error("The search index needs a signed-in session."));
  }
  const name = `search:${user.id}:${deviceId}`;
  if (current?.name !== name) {
    const index = cryptoReady().then(async (handle) => openLocalSearchIndex({ name, keys: await handle.localIndexKeys() }));
    current = { name, index };
  }
  return current.index;
}

export async function applyChanges(changes: SearchChange[]): Promise<void> {
  const index = await getIndex();
  const messages: IndexInput[] = [];
  const edits: EditInput[] = [];
  const write = async () => {
    // Messages first: an edit needs its message in the index.
    await index.add(messages.splice(0));
    await index.applyEdits(edits.splice(0));
  };
  for (const change of changes) {
    if (change.kind === "redacted") {
      await write();
      await index.remove(change.ids);
      continue;
    }
    const { event, payload } = change;
    if (payload.type === "message") {
      messages.push({
        id: event.id,
        channelId: event.channelId,
        senderId: event.senderId,
        createdAt: event.createdAt,
        body: payload.body,
        hasFile: payload.attachments.length > 0,
      });
    } else if (payload.type === "edit" && event.relatesToId) {
      edits.push({ targetId: event.relatesToId, editId: event.id, senderId: event.senderId, body: payload.body });
    }
  }
  await write();
}

export async function searchLocal(query: IndexQuery): Promise<IndexResult[]> {
  return (await getIndex()).search(query);
}

session.store.subscribe((state) => {
  if (state.status === "signedOut" && current) {
    const closing = current.index;
    current = null;
    clearSearchQueue();
    void closing.then((index) => index.close()).catch(() => undefined);
  }
});
