# Discord Clone

This is a self-hosted, end-to-end encrypted chat and voice app, built as a
portfolio project for a small group of friends. It has text channels,
voice channels with peer-to-peer WebRTC, guilds, roles and DMs, in a
Discord-style layout with its own theme.

See `docs/adr` for the main design decisions, and the plan referenced from
`CLAUDE.md` for the full architecture and milestone list.

## Quick start

1. Copy the environment file and fill in real values.

   ```sh
   cp .env.example .env
   ```

2. Start the development services (database, TURN server, mail catcher).
   Run this command from the repository root, so Docker Compose finds the
   `.env` file.

   ```sh
   docker compose --env-file .env -f infra/docker-compose.dev.yml up -d
   ```

3. Install dependencies.

   ```sh
   pnpm i
   ```

4. Start the apps in development mode.

   ```sh
   pnpm dev
   ```

## End-to-end tests

The `e2e` package holds browser tests that need a real WebRTC engine. One
test proves that two browser peers can connect through the local coturn
TURN relay. See `docs/concepts/nat-turn.md` for what a TURN relay is.

1. Install the Playwright browser (once per machine).

   ```sh
   pnpm --filter @discord-clone/e2e exec playwright install chromium
   ```

2. Start coturn.

   ```sh
   docker compose --env-file .env -f infra/docker-compose.dev.yml up -d coturn
   ```

3. Run the end-to-end tests.

   ```sh
   pnpm e2e
   ```

4. Stop coturn when you are done.

   ```sh
   docker compose --env-file .env -f infra/docker-compose.dev.yml down
   ```

The end-to-end tests are not part of the default `pnpm test` run. A
separate CI job runs them on Linux, with coturn started through Docker
Compose.

## Server tests

Most server tests run with no setup. The server auth and users tests also
need a real Postgres database, which they use to make one throwaway
database per test file.

1. Start the database, if it does not run yet.

   ```sh
   docker compose --env-file .env -f infra/docker-compose.dev.yml up -d postgres
   ```

2. Set `TEST_DATABASE_URL` to a user that can create and drop databases.
   The `postgres` service user has this right. Use the `postgres` system
   database as the connection target; the test helper makes its own
   databases next to it.

   ```sh
   export TEST_DATABASE_URL="postgres://discord_clone:<password-from-.env>@localhost:5432/postgres"
   ```

3. Run the tests.

   ```sh
   pnpm test
   ```

When `TEST_DATABASE_URL` is not set, the database-backed tests skip with a
clear message, and every other test still runs.

## Project status

This repository is at milestone M1: user accounts (register, login, token
refresh, email verification, password reset, OAuth, profile and avatar).
See the milestone table in the plan for what comes next.
