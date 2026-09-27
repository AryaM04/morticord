# ADR 0001: P2P mesh for media, a central server for everything else

## Status

Accepted.

## Context

The app needs voice, video and screen share for small groups of friends. It
also needs accounts, guilds, roles and message storage. These two needs have
different trust and scale requirements.

## Decision

Voice and video use a peer-to-peer WebRTC mesh. Each client connects
directly to every other client in a voice channel. A central server handles
accounts, guilds, channels, message storage and signaling. The voice cap is
10 users per channel, so the mesh does not grow past a size a home
connection can support.

## Consequences

- Media never passes through the server, except through TURN when a direct
  path fails. This keeps home upload bandwidth low.
- Each client sends and receives one media stream per other participant, so
  the mesh does not scale past small groups. This is fine for this project.
- The central server is a single point of failure and trust for
  signaling and membership. ADR 0002 covers how encryption limits what the
  server can read.
