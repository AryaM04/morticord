# End-to-end encryption: Olm and Megolm

This note is the protocol specification for milestone M6. Passes 2 to 4
implement against it. Pass 1 builds sections 1 to 6. Read ADR 0002 first.

Words in this note:

- **Device**: one sign-in (see `docs/architecture.md` section 4). Each
  device has its own keys.
- **Identity keys**: the Curve25519 key and the Ed25519 key of one device.
  They never change.
- **Olm**: a 1:1 encrypted channel between two devices (double ratchet).
- **Megolm**: a group ratchet. One sender device, many receiver devices.
- **To-device message**: an Olm message from one device to one device,
  through the server queue.

## 1. Threat model

The server is **honest but curious** for content. It stores and forwards
data correctly, but we assume that the operator (or a thief of the disk)
reads everything that the server has.

The server is **trusted for membership**. It says who is in a guild, a DM
or a channel, and which permissions they have. A malicious server can add
a fake member or a fake device. That member then gets new Megolm keys.
Clients reduce this risk:

- Device keys are signed. The server cannot change the keys of a device.
- The master key of each user is trusted on first use (TOFU). A change
  shows a loud warning and is never accepted silently.
- The channel shows a notice when a new member or a new device appears.

The server **cannot** read message text, file bytes, reactions, edits,
settings or WebRTC signaling. It **can** see this metadata:

- Who is in which guild, channel and DM, and their roles.
- Who sends a message or a to-device message to whom, when, and its size.
- The Megolm session id of each event and the event relations
  (`relates_to_id`, `rel_type`).
- The device list of each user and the number of one-time keys.
- Voice presence and the IP addresses of connections.

Not in scope: a compromised client device, a malicious web bundle from
the server (the web client trusts the code that the server sends; the
desktop apps do not), traffic analysis.

## 2. Encodings

- Curve25519 keys, Ed25519 keys and signatures use **unpadded standard
  base64**. This is the vodozemac form. The server and the clients do not
  change it.
- To-device ciphertext and Megolm ciphertext on the wire use base64url,
  as for all other binary data (`docs/architecture.md` section 2).
- **Canonical JSON** is the input of every signature. Rules: object keys
  in sorted order (by UTF-16 code unit), no white space, strings escaped
  as `JSON.stringify` does, only strings, booleans, null, safe integers,
  arrays and objects. The code is `canonicalJson` in `packages/shared`.
- Each signed object has a `type` field. Thus a signature for one purpose
  cannot be used for a different purpose.

## 3. Device identity and key upload

On the first sign-in, the device makes a vodozemac `Account`. It then
uploads its keys with `POST /keys/upload`:

```json
{
  "deviceKeys": { "curve25519": "...", "ed25519": "...", "signature": "..." },
  "oneTimeKeys": { "<keyId>": { "key": "...", "signature": "..." } },
  "fallbackKey": { "keyId": "...", "key": "...", "signature": "..." }
}
```

All parts are optional. The response is
`{ "oneTimeKeyCount": n, "needsFallbackKey": true|false }`.

Signed objects (the device Ed25519 key signs each one):

| Object | Canonical JSON input |
|---|---|
| Device keys | `{type:"device_keys", userId, deviceId, curve25519, ed25519}` |
| One-time key | `{type:"one_time_key", userId, deviceId, keyId, key}` |
| Fallback key | `{type:"fallback_key", userId, deviceId, keyId, key}` |

The `userId` and `deviceId` are in the signed object. Thus the server
cannot move keys to a different device or user.

Server rules:

- The server verifies each signature with `node:crypto`. It rejects a bad
  signature with 400. Clients still verify each signature themselves.
- Identity keys are set one time. The same keys again are accepted. Other
  keys give 409 `DEVICE_KEYS_EXIST`.
- One-time keys and fallback keys need the identity keys first.
- The server keeps at most 100 one-time keys for each device. The client
  keeps 50 (`max_number_of_one_time_keys`).
- A removed device (signed out, or removed from the device list) cannot
  upload. Its keys, one-time keys and queued messages are deleted.

`READY` has `oneTimeKeyCount` and `needsFallbackKey` for the device.

### One-time keys and fallback keys

`POST /keys/claim` takes `{ devices: [{ userId, deviceId }] }`. For each
device it removes one one-time key and returns it. The claim is atomic
(`DELETE ... FOR UPDATE SKIP LOCKED ... RETURNING`), so two callers never
get the same key. When no one-time key is left, the server returns the
fallback key with `fallback: true`, and marks the fallback key as used.

The client verifies the signature of the claimed key with the Ed25519 key
from its verified device list. It rejects a key with a bad signature.

The device keeps its keys topped up:

- It uploads 50 one-time keys and one fallback key at setup.
- When `READY` or an upload response shows fewer than 25 keys, it makes
  and uploads new keys until the server has 50.
- After each new inbound session, it counts down. At 25 it asks the
  server for the true count (an empty upload).
- When `needsFallbackKey` is true, it makes a new fallback key. vodozemac
  keeps the previous fallback key, so late messages still decrypt.

Crash safety: the client saves the account pickle after it makes keys and
before it uploads them. It marks the keys as published only after the
upload succeeds. The server ignores a key id that it already has.

## 4. Device lists and the master key

### Query

`POST /keys/query` takes `{ userIds }` (at most 500). The response has,
for each visible user, the master key and the devices with keys:

```json
{ "users": [ {
  "userId": "1",
  "masterKey": { "publicKey": "...", "deviceId": "...", "deviceSignature": "..." },
  "devices": [ { "deviceId": "...", "curve25519": "...", "ed25519": "...",
                 "signature": "...", "masterSignature": "..." } ]
} ] }
```

A user is **visible** to the caller when one of these is true: it is the
caller, the two users share a guild, the two users share a DM or a group
DM, or the two users are friends. The server omits other users. The same
rule controls `/keys/claim` and `/to-device`.

### Master key (simplified cross-signing)

Each user has one Ed25519 **master key**. It signs the device keys of the
devices of that user. There is no separate self-signing key.

- The first device of a user makes the master key. It uploads it with
  `PUT /keys/master`:
  `{ publicKey, deviceSignature, masterSignature }`.
  - `deviceSignature`: the device Ed25519 key signs
    `{type:"master_key", userId, publicKey}`.
  - `masterSignature`: the master key signs the device keys object of
    this device.
- The master key is set one time. A different key gives 409
  `MASTER_KEY_EXISTS`. A reset flow comes with the key backup (pass 4).
- A device that holds the master private key can sign a different device
  of the same user. It sends `masterSignature` for that device in a later
  pass. In pass 1 only the first device is signed. Other devices show as
  "not verified by the owner".
- The master private key stays in the crypto store of the first device.
  Pass 4 also puts it in the key backup, so a new device can get it.

### Client verification

For each user in the query response, the client:

1. Verifies the signature of each device. It drops a device with a bad
   signature, a wrong `userId` or a wrong `deviceId`.
2. Keeps the first master key that it sees for this user (TOFU).
3. If the master key changes, it sets `masterKeyChanged` for this user.
   The UI shows a loud warning. The client never replaces the stored key
   silently. The user must accept the new key.
4. Marks a device as **owner-verified** when `masterSignature` verifies
   with the trusted master key.
5. Keeps the known identity keys of a device. If a device id appears with
   different identity keys, the client drops the new keys (identity keys
   never change).

The client tracks users: its own user, and later the members of each
encrypted channel. The gateway sends `DEVICE_LIST_UPDATE { userId }` to
each user who can see that user when a device gets keys, is removed, or
gets a master signature, or when the master key is set. The client marks
that user as outdated and queries again before the next encryption.

## 5. Olm sessions

### Create

To send to a device without a session, the client claims a one-time key,
verifies it, and calls `create_outbound_session`. The first messages are
pre-key messages (type 0). They stay pre-key messages until the other
device replies.

### Select

A device can have more than one session with a peer device. Each session
record has `createdAt` and `lastReceivedAt`. To send, the client uses the
session with the highest `max(createdAt, lastReceivedAt)`. This makes
both sides move to the newest working session.

To receive:

- A pre-key message: use the session where `session_matches` is true.
  If none matches, call `create_inbound_session`. This removes the
  one-time key from the account.
- A normal message (type 1): try each session, newest first.

The client keeps at most 5 sessions for each peer device. It deletes the
oldest.

### Recover a wedged session

A session is **wedged** when no session can decrypt a message from a peer
device, for example after a restore of old state. The receiver then:

1. Claims a new one-time key and makes a new outbound session.
2. Sends a `dummy` envelope on the new session.
3. Does this at most one time per peer device per hour.

The peer creates the inbound session from the pre-key message. Because
it is the newest session, both sides use it from then on. The lost
message is not recovered by Olm. Megolm key requests (pass 3) get the
lost room keys again.

### Per-peer order

All operations on the sessions of one peer device run in one queue. The
account has its own queue. A task that needs both takes the peer queue
first. Thus two tasks never use the same session at the same time.

Only one browser tab of a device runs the crypto layer. It holds the Web
Lock `crypto:<userId>:<deviceId>`. A different tab waits for the lock.

## 6. To-device messages

### Send

`POST /to-device` takes at most 100 messages. Each ciphertext is at most
64 KiB after base64url decode.

```json
{ "messages": [ { "userId": "2", "deviceId": "abc", "type": "olm.v1", "ciphertext": "<base64url>" } ] }
```

The ciphertext bytes are one byte for the Olm message type (0 or 1),
then the Olm message. The server rejects the whole request with 403 when
a recipient user is not visible (section 4). It skips unknown, removed or
keyless devices and lists them in `skipped`.

The queue keeps at most 10 000 messages for each recipient device. The
server deletes the oldest messages above that limit and writes a log
line. The route has a rate limit for each user.

### Deliver and acknowledge

The server sends `TO_DEVICE` dispatches:
`{ id, senderUserId, senderDeviceId, type, ciphertext, createdAt }`.

- `TO_DEVICE` is not in the resume buffer. The queue table is the durable
  store.
- Each gateway session has a window of 100 messages that are sent but not
  acknowledged. The server sends in id order.
- The client sends op `TO_DEVICE_ACK { upToId }` after it saved the
  result of each message up to that id. The server deletes those rows
  and sends more.
- `TO_DEVICE_ACK { upToId, resync: true }` also tells the server to send
  again every message after `upToId`. The crypto layer sends it when it
  starts and after each `READY` or `RESUMED`.
- The server also starts a delivery after `IDENTIFY` and `RESUME`.
- The client drops a message with an id that it already processed. It
  sends one acknowledgement when its local queue is empty, at most one
  time in 2 seconds.

### Envelope

The Olm plaintext is a versioned JSON envelope:

```json
{
  "v": 1,
  "id": "<16 random bytes, base64url>",
  "type": "dummy",
  "content": {},
  "sender": { "userId": "1", "deviceId": "abc", "ed25519": "..." },
  "recipient": { "userId": "2", "deviceId": "def", "curve25519": "..." },
  "ts": 1790000000000
}
```

Olm proves that the sender holds the Curve25519 key of the session. The
envelope binds the rest. The receiver accepts the envelope only when all
of these are true:

- `v` is 1.
- `sender.userId` and `sender.deviceId` are the sender that the server
  reported in the dispatch.
- The Curve25519 key of the Olm session belongs to that device in the
  verified device list, and `sender.ed25519` is the Ed25519 key of that
  device.
- `recipient.userId`, `recipient.deviceId` and `recipient.curve25519` are
  the values of the receiving device.
- The `id` was not seen before (the client keeps the last 1000 ids).

Thus the server cannot forward a message to a different device, or say
that it comes from a different device.

Envelope types: `dummy` (session recovery), `debug.ping` (development
only), and from pass 2: `megolm.session`, `megolm.forward`,
`megolm.request`, `voice.signal` (see `docs/concepts/voice.md`),
`settings.key` and `settings.request` (section 11).

Voice signals use the gateway op `TO_DEVICE_SEND { messages }`. It has
the same rules as `POST /to-device` (visibility, size, queue) and no
reply. The server stores the ops of one connection in the order that they
arrive.

The client acknowledges a message after the session state, the account
state, the seen id and the queue id are saved in one IndexedDB
transaction, and after the handlers of the event are done. A message that
fails is dropped and acknowledged. It never blocks the queue. Olm can
decrypt a message only one time, so a crash after the save and before the
end of the handlers loses the event. Megolm key requests (pass 3) get lost
room keys again.

## 7. Local store and the pickle key

The `CryptoStore` is one IndexedDB database for each user and device:
`crypto:<userId>:<deviceId>`. It holds the account pickle, the Olm
sessions of each peer device, the device list cache with the tracked
users and the outdated flags, the TOFU master keys, the master private key
(when this device has it), the seen envelope ids and the last processed
queue id.

vodozemac encrypts each pickle with a 32-byte **pickle key**. The pickle
key is random. It is kept through `platform.secureStore`:

- Web: the secure store encrypts each value with an AES-GCM `CryptoKey`
  that is **not extractable**. The `CryptoKey` object is kept in
  IndexedDB.
  - Gain: a copy of the IndexedDB files (a disk image, a backup, a
    different program on the computer) does not give the pickle key,
    because the browser keeps the raw AES key outside of the page data in
    a form that the page cannot export.
  - Limit: code that runs in the page (for example XSS) can still use the
    key to decrypt. The browser profile folder also has the key material.
    This protects against offline copies, not against a live attack.
- Tauri and Electron (M7): the OS key store (Keychain, Credential
  Manager, libsecret) keeps the value.

## 8. Megolm (pass 2 and pass 3)

Pass 2 builds this section. The code is `packages/client-core/src/crypto/megolm.ts`
and `membership.ts`.

### Readers of a channel

A user may **read** a channel when it has `VIEW_CHANNEL` and
`READ_MESSAGE_HISTORY`. Only readers get keys. In a DM or a group DM,
every recipient is a reader.

- `GET /channels/:id/members` gives the users who can view the channel,
  with the roles, the overwrites and the owner. The caller must be able
  to view the channel. The server computes the permissions in memory.
- The client computes the permissions again with `computePermissions` in
  `packages/shared`, and keeps only the readers. It fetches the list
  lazily, only for the channels where it sends or answers.
- The client keeps the result for at most 10 minutes. These gateway events
  clear it: `READY`, `GUILD_MEMBER_*`, `GUILD_ROLE_*`, `GUILD_BAN_ADD`,
  `GUILD_CREATE`, `GUILD_DELETE`, `CHANNEL_CREATE`, `CHANNEL_UPDATE`,
  `CHANNEL_DELETE` and `CHANNEL_RECIPIENT_*`.

### Send

- Each sending device has one outbound Megolm session for each channel.
  DMs and group DMs are channels.
- The event has `codec: "megolm-v1"` and `megolmSessionId` in clear text.
  The Megolm plaintext is the `DecryptedPayload` JSON of the message
  codec (`docs/concepts/messages.md`). On the wire, the Megolm message is
  base64url.
- Before each encryption, the client gets the current readers and their
  verified devices. Then it does these steps, in this order:
  1. **Rotate** the outbound session when one of these is true: it
     encrypted 100 messages; it is 7 days old; a reader device that the
     sender saw while the session was in use is not a reader device now
     (leave, kick, ban, role change, overwrite change, recipient removed,
     sign-out, new identity keys); the session is marked for rotation
     (see below).
  2. **Share** the session key (`megolm.session`) with each reader device
     that does not have it, from the current index. This includes the
     other devices of the sender. A new device of a reader
     (`DEVICE_LIST_UPDATE`) thus gets the key before the next message. A
     device that fails gets no new try for 60 seconds.
  3. Encrypt, and save the session before the event goes out.
- The rotation check runs at the next send, with the membership that the
  events above keep fresh. Thus the client never shares a key with a
  device that is not a reader at that moment.
- A reader can forward an outbound session that is still in use (history
  share, key request). The sender does not see that. Thus the sender
  marks its outbound sessions for rotation when a reader can have gone:
  - at once for `GUILD_MEMBER_REMOVE`, `GUILD_BAN_ADD`, `GUILD_DELETE`,
    `CHANNEL_DELETE` and `CHANNEL_RECIPIENT_REMOVE` (in the scope of the
    event), and for `READY` (all sessions: events can be lost while the
    gateway is down);
  - after a role or overwrite change, when the new reader list lacks a
    user of the reader snapshot of the channel.
- The sender also keeps an inbound copy of its own session, so all its
  devices decrypt the same way.

### Session binding

When the sender makes a session, its device Ed25519 key signs
`{type:"megolm_session", channelId, sessionId, userId, deviceId}`. The
signature goes in `megolm.session` and in each `megolm.forward`.

- `megolm.session { channelId, sessionId, sessionKey, signature }`: the
  receiver checks the signature with the key of the Olm sender device,
  and that the session id of the key is `sessionId`.
- `megolm.forward { channelId, sessionId, sessionKey, senderUserId,
  senderDeviceId, senderEd25519, signature }`: `sessionKey` is exported at
  the first known index. When the sender device is in the verified device
  list, `senderEd25519` must be its key. The signature must verify with
  `senderEd25519`.
- The session id is the public key of the session, so it is unique. The
  first sender that a session id arrives with owns it. A later key for
  the same id with a different sender or channel is rejected. A later key
  with an earlier first index replaces the stored one.

### Receive

The receiver finds the inbound session by the session id of the event.
It shows "This message cannot be read." and never throws when one of
these is true:

- The session belongs to a different channel, user or device than the
  event names.
- The sender device is still in the device list, but with a different
  Ed25519 key than the session came with.
- The Megolm message does not decrypt (Megolm also checks the signature
  of the message).
- The message index was already used by a different event id (a replay).
  The client keeps the event id of each index of each session.

When the session is not there (or the message is older than its first
index), the message shows "This message cannot be read yet. The app asks
for the key." The client asks for the key, and decodes the event again
when the key arrives. No reload is necessary.

### History for new readers (`megolm.forward`)

- The client keeps a snapshot of the readers of each channel where it
  has a session. After a membership event (1 second debounce), it
  compares the readers with the snapshot.
- For each new reader, the online devices of the old readers are sorted.
  The first device sends each inbound session of the channel at once.
  The next two devices send after a random delay of 20 to 40 seconds,
  in case the first device is not really online. The other devices send
  nothing. A device sends the history of one channel to one user at most
  one time in 10 minutes.
- Before it sends, the device checks again that the user is a reader.
- The receiver keeps only the best key of each session, so a second copy
  does nothing.

### Key requests (`megolm.request { channelId, sessionId }`)

- A device that cannot decrypt an event asks the devices of its own user,
  the devices of the sender, and the devices of at most 3 other readers
  (online users first). The other readers are necessary: after a new
  sign-in, the old device of the user can be gone, and only other
  members have the keys.
- Tries: at once, then after 5 s, 30 s, 2 min and 10 min. It stops when
  the key arrives. After `READY` or `RESUMED`, the open requests go out
  again at once.
- A device answers only when the requester user is a reader now, and at
  most one time in 30 seconds for each requester device and session. The
  answer is a `megolm.forward` to the requester device only.

### Storage and memory

- The crypto store (IndexedDB version 2) keeps the outbound sessions, the
  inbound sessions and the reader snapshots. The pickles are encrypted
  with the pickle key.
- At most 100 inbound sessions stay unpickled in memory (least recently
  used). The store keeps all of them.

### Plaintext

The server rejects a new `plain-v1` event with 400
`PLAINTEXT_NOT_ALLOWED`. `ALLOW_PLAINTEXT_EVENTS=true` turns the check
off, for old development clients only. The clients never send `plain-v1`.
They can still read old `plain-v1` events.

### Deviations from the first draft of this section, and why

- Readers need `READ_MESSAGE_HISTORY` as well as `VIEW_CHANNEL`, for the
  live key share too. A user without history permission therefore cannot
  read new messages either. Reason: one rule for the key share and the
  history share is simpler to check, and it never gives a key that the
  history rule would refuse.
- The receiver finds a session by its session id, not by the Curve25519
  key of the sender device and the session id. The record keeps the
  sender that was verified when the key arrived. Reason: a sign-out
  removes the device from the device list, and the messages of that
  device must stay readable.
- The session binding signature is new. Reason: without it, a member
  that has a key could forward it and say that a different device made
  it.
- A forward for a sender device that is not in the device list now (for
  example after its sign-out) is accepted when its signature verifies
  with the `senderEd25519` in the forward. Thus the forwarder vouches for
  that key. Risk: a member with a key can say that a removed device of a
  different user made a session. That is useful only together with a
  server that forges events, and the first-owner rule stops it for a
  session that the receiver already has.
- Key requests also go to up to 3 other readers (see above).
- A second tab of the same device waits for the Web Lock of the crypto
  layer. Until it gets the lock, it cannot encrypt or decrypt. It shows
  "Setting up encryption…" when it tries to send.

## 9. Key backup (pass 4)

- A random 256-bit **recovery key** is shown one time. A recovery
  passphrase can make the same key with Argon2id (salt and parameters in
  the backup `auth_data`).
- The recovery key gives a Curve25519 key pair. The client encrypts each
  inbound Megolm session to the public key (HPKE) and uploads it to
  `/keys/backup`. The server cannot decrypt the backup.
- The master private key is also in the backup, encrypted with a key that
  comes from the recovery key. A new device that enters the recovery key
  can then sign itself.
- A new device enters the recovery key or the passphrase, downloads the
  backup and decrypts the full history.

## 10. Verification (later)

Emoji SAS verification between two devices comes after pass 4. Until
then, users compare nothing and trust the master key on first use.

## 11. Encrypted settings (pass 3)

The synced settings blob (`PUT /users/@me/settings`) is encrypted with
the **settings key** of the user: one random AES-256-GCM key. The code is
`packages/client-core/src/crypto/settings-key.ts`.

- Blob: one version byte (1), the 8-byte key id, a 12-byte IV, then the
  AES-GCM ciphertext of the settings JSON. The version byte and the key id
  are the additional data. An old plaintext blob starts with `{`. The
  client reads it, and the next save encrypts it.
- The first device that saves settings, when the server blob is empty or
  plaintext, makes the key. It sends `settings.key { keyId, key }` to each
  other device of the same user in the verified device list.
- A device that reads a blob with an unknown key id sends
  `settings.request { keyId }` to its other devices (at most one time a
  minute). A device that has the key answers with `settings.key` (at most
  one time in 30 seconds for each device). The receiver accepts
  `settings.key` only from a device of the same user, and never replaces a
  known key id with a different value.
- Until the key arrives, the device is **locked**: it shows the defaults
  and its own changes, and it never writes the server blob. When the key
  arrives, it reads the blob again, puts its changes on top and saves.
- The crypto store keeps the keys, encrypted with the pickle key.
- Pass 4 adds the settings key to the key backup.

Deviations and why:

- "Verified" means that the device keys have a valid signature and the
  master key of the user did not change. The owner signature is not
  necessary: pass 1 signs only the first device, so other devices could
  never get the key. When the master key of the user changed, the device
  does not send the key.
- Two new devices can make two keys at the same time. The second save
  then gets `VERSION_CONFLICT`, reads a blob with the other key, and is
  locked until that key arrives. Its own key is never used again.

## Code

- WASM wrapper: `packages/crypto-wasm/src/lib.rs`.
- Server: `apps/server/src/modules/keys`, `apps/server/src/modules/to-device`,
  `GET /channels/:id/members` in `apps/server/src/modules/messages`.
- Client: `packages/client-core/src/crypto`.
- Web: `apps/web/src/lib/crypto.ts` starts the layer, and the codec in
  `apps/web/src/lib/messages.ts` waits for it.
