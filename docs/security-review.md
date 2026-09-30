# Security review of the deployment and the server

Date: 2026-09-30. Milestone M8, pass B.

This document records a security review of the production stack
(`docker-compose.yml`, `infra/`) and of the API server (`apps/server`). The
stack runs on a home network and is open to the internet. Each finding has a
severity, the fix, and the test that checks the fix.

The threat model of the message content is in
`docs/concepts/olm-megolm.md`, section 1. This review is about the server,
the containers and the host.

## 1. Summary

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| F1 | Critical | The production TURN config refused all IPv4 peers | Fixed |
| F2 | High | drizzle-orm had a known SQL injection advisory | Fixed |
| F3 | Medium | No limit on failed sign-ins for one account | Fixed |
| F4 | Medium | Some auth and invite routes had no rate limit | Fixed |
| F5 | Medium | No time limit for a slow request | Fixed |
| F6 | Medium | Four services ran as root with all default capabilities | Fixed |
| F7 | Medium | The TURN secret was on the coturn command line | Fixed |
| F8 | Medium | The TURN certificate needed a manual restart each month | Fixed |
| F9 | Medium | The backups had email addresses and password hashes in plain form | Fixed (optional encryption) |
| F10 | Low | The API used the first X-Forwarded-For entry as the client address | Fixed |
| F11 | Low | The log had the OAuth code of the callback URL | Fixed |
| F12 | Low | Old password reset links stayed valid after a reset | Fixed |
| F13 | Low | coturn relayed on all host addresses and allowed TCP relay | Fixed |
| F14 | Low | A failed nightly backup could keep a partial file | Fixed |
| A1 to A7 | Low | See section 4 | Accepted |

## 2. Findings and fixes

### F1. The production TURN config refused all IPv4 peers (Critical)

The line `denied-peer-ip=::-::1` in `infra/coturn/turnserver.prod.conf` made
coturn 4.7 refuse every IPv4 peer. The coturn log showed
"A peer IP 8.8.8.8 denied in the range: ::-::1". Thus the relay did not work
for any call.

- Fix: the config now has `denied-peer-ip=::1` for the IPv6 loopback address.
- Test: `e2e/tests/turn-peer-rules.spec.ts`. A small TURN client makes an
  allocation. Then it asks for a permission to private addresses (127.0.0.1,
  10.0.0.1, 172.16.0.1, 192.168.1.1, 169.254.169.254, 100.64.0.1). Each
  answer must be error 403. A permission to a public address (8.8.8.8) and
  to the relay address of the server must succeed. The public address
  found this finding.
- CI: the job `turn-prod` starts the `coturn` service of
  `docker-compose.yml` on the Linux host network. It runs the test above and
  the browser relay test `e2e/tests/webrtc-turn.spec.ts`.

### F2. drizzle-orm advisory GHSA-gpj5-g38j-94v9 (High)

`pnpm audit --prod` reported a SQL injection in drizzle-orm below 0.45.2,
through SQL identifiers. The server uses only fixed identifiers, so the
risk was low. But the fix is simple.

- Fix: drizzle-orm 0.45.3 and drizzle-kit 0.31. Drizzle now puts a database
  error in `cause`. The new function `isUniqueViolation` in
  `apps/server/src/db/client.ts` reads both places.
- Test: the full server test suite. It has tests for duplicate email
  addresses, user names, invites and event nonces.
- After the fix, `pnpm audit --prod` finds no known vulnerability.

### F3. No limit on failed sign-ins for one account (Medium)

The login route had a limit for each IP address only. An attacker with many
IP addresses could try many passwords for one account.

- Fix: `apps/server/src/modules/auth/login-guard.ts`. After 10 failed
  sign-ins for one email address in 15 minutes, the login route answers 429
  for that account. The count is for all IP addresses together. The number
  follows `AUTH_RATE_LIMIT_PER_MINUTE`. The guard keeps at most 10,000
  addresses in memory.
- Test: `apps/server/src/modules/auth/rate-limit.test.ts`.

### F4. Routes without a rate limit (Medium)

These routes had no rate limit: `verify-email`, `reset-password`, the three
OAuth routes, and the invite routes (look up, join, create).

- Fix: a limit for each IP address on the auth routes (10 or 30 in each
  minute). A limit for each user on the invite routes (30 in each minute).
  The other routes of the task already had a limit: register, login,
  refresh, forgot-password, friend requests, attachment upload, link
  preview, key upload, key query, key claim and to-device.
- Tests: `apps/server/src/modules/auth/rate-limit.test.ts` and
  `apps/server/src/modules/guilds/invite-rate-limit.test.ts`.

### F5. No time limit for a slow request (Medium)

Fastify has no request time limit by default. Caddy had its default time
limits only.

- Fix: Caddy reads the request headers in at most 10 seconds, and closes an
  idle connection after 2 minutes (`infra/caddy/Caddyfile`). The API server
  closes a request that takes more than 5 minutes (`requestTimeout`). The
  body time in Caddy has no limit, because a large upload on a slow line
  can take minutes.

### F6. Services ran as root (Medium)

Caddy, PostgreSQL, coturn and the backup service ran as root. Only the API
had a read-only file system and no capabilities.

- Fix: in `docker-compose.yml`, each service has `cap_drop: [ALL]`,
  `no-new-privileges:true` and, where possible, a read-only root file
  system with `tmpfs` for `/tmp`.

| Service | User | Read-only root | Capabilities |
| --- | --- | --- | --- |
| caddy | 10001 | Yes | None |
| api | 100 | Yes | None |
| postgres | 70 (postgres) | Yes | None |
| coturn | 10001 | Yes | NET_BIND_SERVICE in the bounding set only (see below) |
| backup | 100 | Yes | None |
| ddns | 1000 | Yes | None |
| ddns-duckdns | root, then its own user | No | Default (the image needs them) |

- Caddy opens ports 80 and 443 without a capability. The sysctl
  `net.ipv4.ip_unprivileged_port_start=0` allows it in the container
  network. `apps/web/Dockerfile` removes the file capability of the
  `caddy` file, because the kernel does not start a file with a capability
  that is not in the bounding set.
- The `turnserver` file has the file capability NET_BIND_SERVICE. We cannot
  change the file in the official image. Thus the capability stays in the
  bounding set. The process has no active capabilities (`CapEff` is 0), and
  all its ports are above 1024.
- coturn uses the same user ID as Caddy, so that it can read the TLS key
  that Caddy writes with the mode 0600.
- Check: `docker compose exec <service> id`. The local test of the stack
  showed the users of the table.
- An existing stack must give the Caddy volumes to user 10001 one time. See
  `docs/deploy.md`, section 11.

### F7. The TURN secret was on the coturn command line (Medium)

`docker-compose.yml` gave the secret to coturn as a command-line flag. Every
user of the host can read the command line of a process with `ps`. Also,
the entrypoint of the coturn image runs `eval` on each argument.

- Fix: `infra/coturn/start.sh` replaces the image entrypoint. It writes the
  secret into a config file in `/tmp` (mode 0600). The secret comes from the
  environment of the container. Only root and the same user can read it.

### F8. Manual restart for the TURN certificate (Medium)

coturn read the TLS certificate only at start. The guide told the operator
to restart coturn each month. If the operator forgot it, TURN over TLS used
an expired certificate.

- Fix: `infra/coturn/start.sh` starts a small watcher. Each hour, it
  compares the change times of the certificate and the key. When they
  change, it sends SIGUSR2 to coturn, and coturn reads the files again. We
  checked this signal with coturn 4.7.0: the log shows "Reloading TLS
  certificates and keys". When a certificate file appears for the first
  time, the watcher stops coturn, and Docker starts it again with the file.
  No container has access to the Docker socket.
- The watcher also finds the certificate of each certificate authority
  (Let's Encrypt, ZeroSSL and the Caddy test authority).

### F9. Backups in plain form (Medium)

Messages and attachments are ciphertext. But the database dump has the
email addresses, the password hashes (Argon2id) and the user names.

- Fix: set `BACKUP_AGE_RECIPIENT` to an `age` public key. The backup service
  then encrypts each file to this key. The private key stays on a different
  computer. See `docs/deploy.md`, section 9. We tested an encrypted backup
  and its decryption with `pg_restore --list`.

### F10. The client address came from the first X-Forwarded-For entry (Low)

With `TRUST_PROXY=true`, Fastify trusted all proxy hops. The client address
was then the first entry of X-Forwarded-For, which a client can write.
Caddy replaces this header for a client that is not a trusted proxy, so the
fault was not open through Caddy. We checked this: requests with a false
header got the real address in the API log.

- Fix: the server trusts only the direct peer (Caddy). The client address is
  the last entry, which Caddy adds. Note: a hop count (`trustProxy: 1`)
  does not do this in the current Fastify version. Fastify then trusts no hop.
- Test: `apps/server/src/modules/auth/rate-limit.test.ts`.

### F11. The OAuth code in the log (Low)

The request log had the full URL. The URL of the OAuth callback has the
one-time authorization code and the state.

- Fix: the request log has the path without the query string.
- Test: `apps/server/src/app.test.ts`.

### F12. Old reset links stayed valid (Low)

After a password reset, other unused reset links of the same user still
worked for up to one hour.

- Fix: a reset marks all reset links of the user as used.
- Test: `apps/server/src/modules/auth/routes.test.ts`.

### F13. coturn relay surface (Low)

- coturn relayed on all host addresses, which include the Docker bridge
  addresses. It now relays only on the LAN address of the server
  (`relay-ip`, from `TURN_EXTERNAL_IP`).
- The config now has `no-tcp-relay` (the clients relay UDP only) and
  `no-rfc5780` (no answers for NAT behavior tests).
- The list of refused IPv6 ranges is now the same as the list of the link
  preview fetch.
- coturn allows one private address: the LAN address of the server. Two
  peers that both use the relay need it. coturn 4.7 also allows this
  address by itself when `TURN_EXTERNAL_IP` has the "PUBLIC/LAN" form.

### F14. Partial backup files (Low)

In the nightly loop, the backup function ran as `backup_once || ...`. In
this position, `set -e` does not stop the function. A failed `pg_dump` could
thus give a partial file with a correct name.

- Fix: each step of `infra/scripts/backup.sh` checks its result, with
  `pipefail`. A failed step removes the temporary files. The script also
  tells the operator when the backup folder is not writable.

## 3. Checks without a finding

- **Exposure.** Only Caddy publishes ports (80, 443 and 443/udp). coturn
  uses the host network with 3478, 5349 and the relay range. PostgreSQL and
  the API have no published port. There is no admin surface: the Caddy admin
  API listens on 127.0.0.1 in its container, and coturn has `no-cli`.
- **HTTP headers.** HSTS, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`, a CSP without inline scripts, `frame-ancestors
  'none'`, and now `Cross-Origin-Opener-Policy`. The CSP allows inline
  styles (see A2).
- **CORS and WebSocket origin.** CORS headers go only to the origins of
  `CORS_ALLOWED_ORIGINS`, without credentials. The gateway refuses a
  WebSocket upgrade from another origin with 403. We checked both results
  with curl on the local stack.
- **Body size.** Fastify allows 1 MiB for JSON. Avatar and icon routes allow
  1 MiB, the settings and to-device routes have their own limits. Caddy
  limits the body of `/api/*` to `MAX_ATTACHMENT_BYTES`. The attachment route
  checks the length and the quota while the file streams.
- **Tokens.** The access token (HS256 JWT) is valid for 15 minutes.
  `JWT_SECRET` must have at least 32 characters, and the secret script
  makes 64 hex characters. A refresh token is valid for 30 days. Each use
  replaces it. A second use of an old refresh token signs out the device.
  The server stores only SHA-256 hashes of refresh, email and reset tokens.
- **Password reset.** The token has 32 random bytes, is valid for 1 hour and
  works one time. A reset ends all sessions of the user.
- **OAuth.** The state is in a signed, HTTP-only cookie with a 10-minute
  life. Google uses PKCE. The callback gives the tokens to the app through a
  one-time code in the URL fragment, not in the query.
- **SQL.** All queries use the Drizzle query builder or the `sql` template
  with parameters. There is no `sql.raw` and no identifier from user input.
- **Paths.** Avatar, icon and attachment files have a numeric ID as the
  file name. The routes check the ID with `^[0-9]+$` first.
- **Uploads.** Avatars and icons must start with the bytes of a PNG, JPEG or
  WEBP file. Attachments are ciphertext. The server sends them as
  `application/octet-stream` with `nosniff`.
- **SSRF.** The link preview fetch resolves each name, refuses a name with
  any private address, and connects to the checked address. This also stops
  DNS rebinding between the check and the connection. Each redirect goes
  through the same check. Only ports 80 and 443 are allowed.
- **Secrets in the log.** The server log has no request headers and no
  bodies. No log line in the code has a token, a password or a secret.
  `.env` is in `.gitignore`, and the secret script makes it with mode 0600.
- **Dependencies.** `pnpm audit --prod`: no finding after F2.
  `cargo audit` in `packages/crypto-wasm`: no finding.
  `cargo audit` in `apps/desktop-tauri/src-tauri`: no vulnerability. It shows
  3 warnings: `proc-macro-error` is unmaintained, `glib` has an unsound
  iterator, and one `yoke-derive` version is yanked. `glib` is part of the
  Linux GTK build only. The Linux app uses Electron, so these crates are not
  in a released app.

## 4. Accepted risks

- **A1. Email enumeration.** Registration answers `EMAIL_TAKEN` when the
  email address has an account. This is necessary for a clear sign-up
  message. The register and forgot-password routes have a rate limit.
- **A2. Inline styles.** The CSP has `style-src 'unsafe-inline'`, the same
  as the desktop apps. Scripts cannot run inline. React escapes all text.
- **A3. Account lock.** An attacker can stop the password sign-in of a
  known email address for 15 minutes (F3). OAuth sign-in still works.
- **A4. Gateway connections.** The gateway has no rate limit for each IP
  address. A socket that does not identify in time closes.
- **A5. Memory state.** The rate limits live in the memory of one process.
  A restart clears them.
- **A6. DuckDNS image.** The optional `ddns-duckdns` service must start as
  root. It has `no-new-privileges`. The `ddns` service (Cloudflare) runs
  without root rights.
- **A7. The relay can reach the server LAN address.** See F13. The relay
  sends UDP only. Do not run UDP services on the LAN address of the server
  that must not get packets from the internet.

## 5. Manual steps for the operator

- On Linux, give `BACKUP_DIR` to user 100: `sudo chown 100:101 <BACKUP_DIR>`.
- For an existing stack, give the Caddy volumes to user 10001 one time
  (`docs/deploy.md`, section 11).
- Set `TURN_EXTERNAL_IP` in the "PUBLIC_IP/LAN_IP" form behind a router.
- Optional: set `BACKUP_AGE_RECIPIENT`.
- Do the host hardening steps of `docs/deploy.md`, section 11.
