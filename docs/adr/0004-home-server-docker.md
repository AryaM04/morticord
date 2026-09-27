# ADR 0004: Self-hosted home server, run with Docker Compose

## Status

Accepted.

## Context

The app is a portfolio project for a small group of friends. It must run on
a home machine with a public IP and port forwarding, at low cost, with one
simple start command.

## Decision

The full stack runs with Docker Compose: a reverse proxy with automatic
TLS, the API and gateway server, PostgreSQL, and a self-hosted coturn TURN
server. All host-specific values (domain, ports, secrets) live in a `.env`
file, not in code.

## Consequences

- One command starts the stack on any machine with Docker: `docker compose
up -d`, after the `.env` file is filled in.
- The server operator (a friend, trusted by the group) can still see
  metadata about guilds, channels and membership. ADR 0002 limits this to
  metadata only, not message content.
- Home network setup (port forwarding, dynamic DNS, coturn hardening) is
  manual work, tracked in milestone M8 and `docs/concepts` notes.
