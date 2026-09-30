#!/bin/sh
# Restore a backup into the running stack.
# Usage: infra/scripts/restore.sh DB_FILE [DATA_FILE]
# The file names are names inside BACKUP_DIR, for example:
#   infra/scripts/restore.sh db-20260930-030000.dump data-20260930-030000.tar.gz
#
# WARNING: This replaces the current database and data files.

set -eu
[ $# -ge 1 ] || { echo "Usage: restore.sh DB_FILE [DATA_FILE]" >&2; exit 1; }
cd "$(dirname "$0")/../.."

docker compose up -d --wait postgres
docker compose stop api
docker compose run --rm --no-deps backup restore "$@"
docker compose up -d
