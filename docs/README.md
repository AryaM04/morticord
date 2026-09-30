# Documentation index

Start with the `README.md` in the repository root. Then use this list.

## Guides

- [`architecture.md`](architecture.md): code rules, API shape, tokens and test rules. Read it before you change code.
- [`deploy.md`](deploy.md): how to run the full stack on a home server.
- [`security-review.md`](security-review.md): the security review of the stack and the API server, with the fixes.

## Design decisions

- [`adr/0001-p2p-mesh-central-server.md`](adr/0001-p2p-mesh-central-server.md): P2P mesh for media, a central server for the rest.
- [`adr/0002-e2ee-olm-megolm.md`](adr/0002-e2ee-olm-megolm.md): end-to-end encryption with Olm and Megolm.
- [`adr/0003-tauri-and-electron-linux.md`](adr/0003-tauri-and-electron-linux.md): Tauri for Windows and macOS, Electron for Linux.
- [`adr/0004-home-server-docker.md`](adr/0004-home-server-docker.md): a home server that runs with Docker Compose.

## Concept notes

The index of these notes is in [`concepts/README.md`](concepts/README.md).

- [`concepts/auth.md`](concepts/auth.md): accounts, tokens, devices and OAuth.
- [`concepts/gateway.md`](concepts/gateway.md): the WebSocket protocol.
- [`concepts/permissions.md`](concepts/permissions.md): permission flags and overwrites.
- [`concepts/messages.md`](concepts/messages.md): channel events and history.
- [`concepts/attachments.md`](concepts/attachments.md): encrypted files.
- [`concepts/link-previews.md`](concepts/link-previews.md): sender-made link previews.
- [`concepts/search.md`](concepts/search.md): the local encrypted search index.
- [`concepts/dms-and-friends.md`](concepts/dms-and-friends.md): friends, DMs and user settings.
- [`concepts/voice.md`](concepts/voice.md): voice signaling and the mesh.
- [`concepts/nat-turn.md`](concepts/nat-turn.md): STUN and TURN.
- [`concepts/olm-megolm.md`](concepts/olm-megolm.md): the end-to-end encryption specification.
- [`concepts/desktop-shells.md`](concepts/desktop-shells.md): the desktop apps.
