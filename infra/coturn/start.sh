#!/bin/sh
# Start coturn in the production stack (see docker-compose.yml).
#
# This script does these steps:
# 1. It writes the TURN secret and the addresses into a config file in
#    /tmp. The secret is then not on the command line, where "ps" on the
#    host can show it.
# 2. It finds the TLS certificate of DOMAIN in the Caddy data.
# 3. It starts a watcher. When Caddy renews the certificate, the watcher
#    sends SIGUSR2 to coturn, and coturn reads the new files again. When a
#    certificate file appears for the first time, the watcher stops coturn.
#    Docker then starts the container again, and coturn uses the new file.
# 4. It replaces itself with coturn.
#
# Variables: DOMAIN, TURN_SECRET, TURN_EXTERNAL_IP ("PUBLIC_IP/LAN_IP", or
# one IP address when the host has the public IP address itself),
# TURN_CERT_CHECK_SECONDS (default 3600).

set -eu
umask 077

: "${DOMAIN:?Set DOMAIN in .env}"
: "${TURN_SECRET:?Set TURN_SECRET in .env}"
: "${TURN_EXTERNAL_IP:?Set TURN_EXTERNAL_IP in .env}"
CERT_ROOT=/caddy-data/caddy/certificates
CHECK_SECONDS=${TURN_CERT_CHECK_SECONDS:-3600}
CONFIG=/tmp/turnserver.conf
# The address of this host that the relay uses: the part after the "/".
RELAY_IP=${TURN_EXTERNAL_IP#*/}

cp /etc/coturn/turnserver.conf "$CONFIG"
{
  echo "static-auth-secret=$TURN_SECRET"
  echo "external-ip=$TURN_EXTERNAL_IP"
  # Relay only on this address, not on the Docker bridge addresses.
  echo "relay-ip=$RELAY_IP"
  # coturn changes a peer address that is the public address of the relay
  # to RELAY_IP before it checks the peer rules. Allow that one address, so
  # that two peers that both use the relay can reach each other. The
  # "denied-peer-ip" rules refuse every other private address.
  echo "allowed-peer-ip=$RELAY_IP"
} >> "$CONFIG"

# Print the newest certificate file of DOMAIN and the change times of the
# certificate and the key. Caddy keeps one folder for each certificate
# authority. Print nothing when there is no certificate.
cert_state() {
  for file in $(ls -t "$CERT_ROOT"/*/"$DOMAIN"/"$DOMAIN".crt 2>/dev/null); do
    echo "$file" $(stat -c %Y "$file" "${file%.crt}.key" 2>/dev/null)
    return 0
  done
}

state=$(cert_state)
cert=${state%% *}
if [ -n "$cert" ]; then
  set -- "$@" "--cert=$cert" "--pkey=${cert%.crt}.key"
else
  echo "There is no TLS certificate for $DOMAIN. TURN over TLS stays off until Caddy gets one."
fi

# After the exec below, coturn has the process ID of this shell.
coturn_pid=$$
(
  while sleep "$CHECK_SECONDS"; do
    new_state=$(cert_state)
    if [ "$new_state" = "$state" ]; then
      continue
    fi
    if [ "${new_state%% *}" != "$cert" ]; then
      echo "A new TLS certificate file is available. coturn stops, and Docker starts it again."
      kill -TERM "$coturn_pid"
      exit 0
    fi
    echo "The TLS certificate changed. coturn reads it again."
    kill -USR2 "$coturn_pid"
    state=$new_state
  done
) &

exec turnserver -c "$CONFIG" "$@"
