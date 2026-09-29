# Local search

The server keeps only ciphertext, so it cannot search messages. Each
device keeps its own search index of the messages that it decrypted:
live messages, fetched pages and messages that a key backup restored.
Search shows only messages this device has seen.

## What goes in the index

- The message store calls `onDecoded` for each decoded event and
  `onRedacted` for each redaction (`packages/client-core/src/messages-store.ts`).
- `apps/web/src/lib/search-queue.ts` (in the main bundle, small) collects
  these changes. After 1.5 s it gives them to
  `apps/web/src/lib/search-indexer.ts`, which loads with a dynamic import.
  The queue keeps at most 5000 changes while the index is not ready.
- A message adds its words. An edit from the sender of the message
  replaces the words and the text, and only a newer edit wins. A
  redaction removes the message. A reaction adds nothing.
- The index keeps at most 200 000 messages. It drops the oldest first.

## Words and queries

- A word is a run of letters and digits. The index folds case and removes
  diacritics (NFKD), so "Crème" and "creme" match. A search matches whole
  words, and a result has every word of the query.
- Filters: `from:@name` (user name, display name or nickname),
  `in:#channel` (the current guild first), `has:file`, `has:link`.
- The code: `packages/client-core/src/search/`.

## Storage and encryption at rest

One IndexedDB database for each user and device: `search:<userId>:<deviceId>`.
Two keys come from the pickle key of the crypto store with HKDF-SHA-256
(`CryptoHandle.localIndexKeys`). Page code cannot export them.

Each message record holds:

| Field                             | At rest                            |
| --------------------------------- | ---------------------------------- |
| Words, `has:file`, `has:link`     | HMAC-SHA-256 tags (96 bits)        |
| Text and the file flag            | AES-256-GCM, a random IV each time |
| Event, channel and sender ids, time | Plain. The server knows them too. |

**The choice.** We store a tag for each word, not one encrypted blob for
the whole index:

- Word tags: a search reads only the records of the rarest word (an
  IndexedDB multi-entry index). A write, an edit or a redaction changes
  one record. Memory use stays low. The cost: a person with a copy of the
  database can see which messages share a word and how often a tag
  occurs. The person cannot read a word without the key.
- One encrypted blob (not chosen): it hides even these patterns. But each
  search must decrypt and scan the whole index (up to 200 000 messages),
  and each new message must write a large blob again. That is too much
  CPU and memory for a home-server client.

## The search box

The search box is in the chat header. Enter opens the results panel
(channel, author, time and a snippet). The panel and the search code load
only then. A click on a result opens the channel, loads the page around
the message (`jumpTo`), scrolls to it and highlights it
(`apps/web/src/lib/jump.ts`).
