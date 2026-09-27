# NAT, STUN and TURN

This note explains why two computers cannot always connect directly, and
how this app works around that problem for voice and video calls.

## The problem: NAT

Most home networks sit behind a router that does Network Address
Translation (NAT). The router gives each device inside the home a
private address, and it hides that address from the rest of the
internet. Other computers on the internet cannot open a new connection
into the home network by themselves.

This is a problem for a peer-to-peer voice call. Two friends, each behind
their own router, cannot simply open a direct connection to each other.

## STUN: find the public address

STUN (Session Traversal Utilities for NAT) is a small server with one
job. A client asks it: "what public address and port do you see me
coming from?" The STUN server reads this from the network packet, and
sends it back.

With this public address, many NAT routers will let a direct connection
through, once both sides know where to send packets. This path is called
a direct or "host" or "server-reflexive" candidate in WebRTC terms. It
is the cheapest path, since traffic goes straight between the two
computers.

STUN fails for some routers. A "symmetric" NAT gives a different public
port for each remote address a client talks to. STUN cannot predict that
port, so the direct path does not work.

## TURN: relay all the traffic

TURN (Traversal Using Relays around NAT) is the fallback. A TURN server
sits on the open internet. Each side opens a connection to the TURN
server, and the TURN server copies traffic between them. Neither side
needs to accept an incoming connection from the other, so this works
even through the hardest NAT.

TURN costs more than a direct path: every audio and video packet makes
an extra hop through the TURN server, and that server needs enough
network bandwidth for every active call. This app runs its own TURN
server (coturn) on the home server, so this cost stays inside the home
network's own connection.

WebRTC tries the direct path, the STUN path and the TURN path together,
and picks whichever candidate pair connects first. This project's TURN
spike test forces the TURN path only, with `iceTransportPolicy: "relay"`,
so it can check that the relay path works by itself.

## The HMAC credential trick

A TURN server must stop strangers from using it for free. This app uses
coturn's "use-auth-secret" mode, which needs no user database on the
TURN server itself.

The idea: the app server and the TURN server share one long-term secret
key. Nobody else ever sees this key.

1. When a client needs to make a call, it asks the app server for TURN
   credentials.
2. The app server picks an expiry time a short while in the future (for
   example, one hour from now), and builds a username string:
   `<expiry-time>:<user-id>`.
3. The app server signs this username with HMAC-SHA1, keyed with the
   shared secret, and encodes the result as base64. This is the
   credential (the TURN password).
4. The client gets the username and the credential, and gives them to
   its TURN server settings.
5. The TURN server has the same shared secret. When the client connects,
   the TURN server reads the expiry time out of the username, checks
   that time has not passed, then runs the same HMAC over the username
   and checks the result matches the credential it was given.

This means the app server can hand out working TURN credentials without
storing them anywhere, and each credential stops working on its own
after its expiry time passes. See `apps/server/src/turn.ts` for the code
that builds these credentials, and `infra/coturn/turnserver.conf` for the
matching TURN server setting.
