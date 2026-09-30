# Deploy the server on a home machine

This guide shows how to run the full stack on a home machine. The stack
has a web server with automatic HTTPS (Caddy), the API, PostgreSQL, a TURN
server (coturn), and a nightly backup. One command starts all of it.

## 1. What you need

- A computer that runs all day. Use Linux. Docker Desktop (Windows and
  macOS) is for tests only, because the TURN server needs the Linux host
  network.
- 2 CPU cores, 2 GB of RAM and 20 GB of free disk space. The stack uses
  about 150 MB of RAM when no user is active.
- A second disk or a network share for the backup files (recommended).
- A domain name, or a free dynamic DNS name (see step 4).
- Access to the settings of your router.
- An SMTP account to send account email (verification and password reset).

## 2. Install Docker on Linux

1. Install Docker Engine and the Compose plugin. Follow the official guide
   for your distribution: `https://docs.docker.com/engine/install/`.
2. Add your user to the `docker` group: `sudo usermod -aG docker $USER`.
3. Log out and log in again.
4. Check the install: `docker compose version`.
5. Install Git: `sudo apt install git`.

## 3. Get the code and make the settings file

1. Get the code: `git clone <repository URL> discord-clone`.
2. Go into the folder: `cd discord-clone`.
3. Make the `.env` file with random secrets: `node scripts/generate-secrets.mjs`.
   If Node.js is not installed, use Docker instead:
   `docker run --rm -v "$PWD":/work -w /work node:24-alpine node scripts/generate-secrets.mjs`.
4. Open the `.env` file. Set these values:
   - `DOMAIN`: your domain name, for example `chat.example.com`.
   - `ACME_EMAIL`: your email address for the certificate.
   - `TURN_EXTERNAL_IP`: your public IP address and the LAN address of the
     server, in this form: `203.0.113.7/192.168.1.20`.
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`.
   - `BACKUP_DIR`: a folder on the backup disk.
   - `CORS_ALLOWED_ORIGINS`: see step 8.
5. Keep the `.env` file secret. Do not commit it.

The stack sets the other values itself. The end of `.env.example` lists them.

## 4. DNS

The domain must point to the public IP address of your home network.

- If your IP address does not change: make an `A` record for `DOMAIN` with
  your public IP address.
- If your IP address changes: use dynamic DNS.
  - Cloudflare: make an `A` record for `DOMAIN` with any value. Make an API
    token with the permission "Zone - DNS - Edit". Put it in
    `CLOUDFLARE_API_TOKEN`. Set `COMPOSE_PROFILES=ddns` in `.env`.
  - DuckDNS: make a name at `duckdns.org`. Put the name in
    `DUCKDNS_SUBDOMAIN` and the token in `DUCKDNS_TOKEN`. Set
    `COMPOSE_PROFILES=ddns-duckdns` in `.env`. Set `DOMAIN` to the full
    `<name>.duckdns.org` name.

The TURN server needs the public IP address in `TURN_EXTERNAL_IP`. If your
public IP address changes, change this value and run `docker compose up -d`
again.

## 5. Router and firewall

Check for CGNAT first. Open the status page of your router and read the
WAN IP address. Then compare it with the result of `https://ifconfig.me`.
If the two addresses are different, or the WAN address starts with `100.64`
to `100.127`, your provider uses CGNAT. Port forwarding does not work with
CGNAT. Ask your provider for a public IP address, or use a VPS instead.

Give the server a fixed LAN address (a DHCP reservation). Then make these
port forwards to the LAN address of the server:

| Port | Protocol | Use |
| --- | --- | --- |
| 80 | TCP | Certificate request (Let's Encrypt) and redirect to HTTPS |
| 443 | TCP and UDP | The web app, the API and the gateway |
| 3478 | UDP and TCP | TURN |
| 5349 | TCP | TURN over TLS |
| 40000-40099 | UDP | TURN relay ports |

If you change `TURN_RELAY_MIN_PORT` or `TURN_RELAY_MAX_PORT` in `.env`,
forward the new range. Keep the range below 49152. Each user in a relayed
call needs about 10 ports.

If the host has a firewall, open the same ports. On Ubuntu with ufw, run
these commands:

```
sudo ufw allow 80,443,3478,5349/tcp
sudo ufw allow 443,3478/udp
sudo ufw allow 40000:40099/udp
```

## 6. First start

1. Start the stack: `docker compose up -d --build`.
   The first build takes several minutes.
2. Check that all services run: `docker compose ps`.
3. Wait one minute. Then open `https://<DOMAIN>` in a browser. Caddy gets
   the certificate on the first request.
4. Click "Register" and make the first account. The server sends a
   verification email. Open the link in the email.
5. Turn on TURN over TLS. The certificate file now exists. Set
   `TURN_TLS_ENABLED=true` in `.env`. Then run `docker compose up -d` and
   `docker compose restart coturn`.

The first account has no special rights. Use it to make a server (guild)
and to invite your friends.

## 7. Updates

1. Go into the folder of the stack.
2. Get the new code: `git pull`.
3. Build and restart: `docker compose up -d --build`.
4. Remove old images: `docker image prune -f`.

The API runs the database migrations when it starts. Make a backup before
a large update (see step 9).

Caddy renews the certificate about every 60 days. coturn reads the
certificate only at start. Run `docker compose restart coturn` each month.
This cron line does it:

```
0 4 1 * * cd /path/to/discord-clone && docker compose restart coturn
```

## 8. Desktop apps

The desktop apps open the server from a different origin. Add the origins to
`CORS_ALLOWED_ORIGINS` in `.env`, separated by commas:

```
CORS_ALLOWED_ORIGINS=app://discord-clone,http://tauri.localhost,tauri://localhost
```

- `app://discord-clone`: the Linux app (Electron).
- `http://tauri.localhost`: the Windows app (Tauri).
- `tauri://localhost`: the macOS app (Tauri).

Run `docker compose up -d` to apply the change. In the desktop app, enter
`https://<DOMAIN>` as the server address.

## 9. Backups and restore

The `backup` service starts a backup each day at `BACKUP_HOUR` (UTC). Each
backup makes two files in `BACKUP_DIR`:

- `db-<date>-<time>.dump`: the database (PostgreSQL custom format, compressed).
- `data-<date>-<time>.tar.gz`: the data files (avatars, icons and attachments).

The service keeps the files of the last `BACKUP_KEEP_DAYS` days (default 14).
To make a backup now: `docker compose run --rm backup once`.

Copy the files in `BACKUP_DIR` to a second place, for example a cloud
drive. A backup on the same disk does not help when the disk fails.

WARNING: A restore replaces the current database and data files.

To restore, use the file names from `BACKUP_DIR`:

- Linux and macOS: `sh infra/scripts/restore.sh db-20260930-030000.dump data-20260930-030000.tar.gz`
- Windows (PowerShell): `./infra/scripts/restore.ps1 db-20260930-030000.dump data-20260930-030000.tar.gz`

The script starts the database, stops the API, restores the files, and
starts the stack again. The data file is optional.

### Restore test

Do this test after you set up the stack, and again each few months. A
backup that you did not test can be useless.

1. Make a backup: `docker compose run --rm backup once`.
2. Count the users: `docker compose exec postgres sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -tAc "select count(*) from users"'`.
3. Delete all the volumes: `docker compose down -v`.
4. Restore with the two newest files (see above).
5. Count the users again. The two numbers must be the same.
6. Open the web app and sign in.

Step 3 also deletes the certificate. Caddy gets a new one. Let's Encrypt
limits the number of new certificates, so do not repeat this test often on a
real domain. For a test with no limit, use a different `.env` with
`DOMAIN=localhost` and `TLS_MODE=internal`.

## 10. Hairpin NAT (access from the home network)

Some routers cannot send traffic from the LAN to their own public address
(hairpin NAT). Then `https://<DOMAIN>` does not open on the home network.
To fix it, make a local DNS override so that devices on the LAN resolve
`DOMAIN` to the LAN address of the server. Use the DNS settings of your
router, or a Pi-hole. Calls between two devices on the same LAN still work,
because the peers connect directly.

## 11. Security notes

- The TURN server refuses peer addresses in private ranges. This means that
  nobody can use it to reach your home network. A call between two devices
  on the same LAN uses a direct connection.
- PostgreSQL has no published port. Only the API and the backup service can
  reach it.
- Keep the host system updated. Turn on automatic security updates.
- Do not forward any other port.

## 12. Troubleshooting

Show the logs of a service: `docker compose logs --tail 100 <service>`.
The service names are `caddy`, `api`, `postgres`, `coturn` and `backup`.

- **No certificate.** Check that ports 80 and 443 reach the server from the
  internet, and that the DNS record points to your public IP address. Read
  `docker compose logs caddy`. Let's Encrypt limits failed attempts, so fix
  the problem before you try again.
- **The API does not start.** Read `docker compose logs api`. A wrong or
  missing value in `.env` gives a clear error message.
- **WebSocket check.** Open the web app, then the browser developer tools
  and the Network tab. Filter by "WS". The `/gateway` request must have the
  status 101. Or run this command:
  `curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Origin: https://<DOMAIN>" https://<DOMAIN>/gateway`.
  The first line of the answer must be `HTTP/1.1 101`.
- **TURN check.** Sign in, then get TURN credentials from
  `GET /api/v1/voice/turn-credentials` (see `docs/concepts/nat-turn.md`).
  Put the URL, the user name and the password in a public tester, for
  example the "Trickle ICE" page at
  `https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/`.
  Use the URL `turn:<DOMAIN>:3478`. The result must have a candidate of the
  type `relay`. If it has none, check the port forwards for 3478 and the
  relay range, and check `TURN_EXTERNAL_IP`.
- **Calls do not connect between different networks.** Do the TURN check
  above. Check CGNAT (step 5).
- **The site does not open on the home network.** See step 10.
- **Disk space.** Run `docker system df`. Run `docker image prune -f`.
