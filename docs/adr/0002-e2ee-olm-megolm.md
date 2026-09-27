# ADR 0002: End-to-end encryption with Olm and Megolm

## Status

Accepted.

## Context

Messages, files and voice signaling must stay private from the server
operator. The app needs group encryption for channels, and it must let new
members read channel history.

## Decision

The app uses the Matrix-style Olm and Megolm protocols, through the
`vodozemac` library compiled to WebAssembly. Olm secures one-to-one
device sessions, used for key shares and WebRTC signaling. Megolm secures
group messages in a channel, with one outbound session per sending device.

## Consequences

- The server stores only ciphertext for message content and file bytes. It
  still sees metadata: who is in which channel, and message timestamps.
- New members can read history because an online member forwards the
  Megolm session key to them. This needs the server-trusted membership
  trade-off described in ADR 0004 and in `docs/concepts/olm-megolm.md`.
- Session rotation on membership loss adds real complexity, tracked and
  tested in milestone M6.
