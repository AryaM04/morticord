#!/bin/sh
# Back up the database and the data directory, or restore them.
#
# This script runs inside the "backup" service of docker-compose.yml.
#   backup.sh loop     Wait for the next backup time, then back up. Repeat each day.
#   backup.sh once     Make one backup now.
#   backup.sh restore DB_FILE [DATA_FILE]
#                      Replace the database (and the data) with a backup.
#
# Variables: PGHOST, PGUSER, PGPASSWORD, PGDATABASE, BACKUP_KEEP_DAYS,
# BACKUP_HOUR (the hour of the day in UTC, 0 to 23).

set -eu

BACKUP_DIR=/backup
DATA_DIR=/data

backup_once() {
  stamp=$(date -u +%Y%m%d-%H%M%S)
  echo "Backup $stamp starts."
  # Write to a name that the prune step ignores, then rename. A failed run leaves no half file.
  pg_dump --format=custom --compress=6 --file="$BACKUP_DIR/.db-$stamp.tmp"
  tar -czf "$BACKUP_DIR/.data-$stamp.tmp" -C "$DATA_DIR" .
  mv "$BACKUP_DIR/.db-$stamp.tmp" "$BACKUP_DIR/db-$stamp.dump"
  mv "$BACKUP_DIR/.data-$stamp.tmp" "$BACKUP_DIR/data-$stamp.tar.gz"
  find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'data-*.tar.gz' \) \
    -mtime "+${BACKUP_KEEP_DAYS:-14}" -delete
  echo "Backup $stamp is done."
}

restore() {
  db_file="$BACKUP_DIR/$1"
  [ -f "$db_file" ] || { echo "The file does not exist: $db_file" >&2; exit 1; }
  echo "Restore of the database from $1 starts."
  pg_restore --clean --if-exists --no-owner --no-acl --dbname="$PGDATABASE" "$db_file"
  if [ -n "${2:-}" ]; then
    data_file="$BACKUP_DIR/$2"
    [ -f "$data_file" ] || { echo "The file does not exist: $data_file" >&2; exit 1; }
    echo "Restore of the data from $2 starts."
    find "$DATA_DIR" -mindepth 1 -delete
    tar -xzf "$data_file" -C "$DATA_DIR"
  fi
  echo "Restore is done."
}

case "${1:-loop}" in
  once)
    backup_once
    ;;
  restore)
    [ -n "${2:-}" ] || { echo "Usage: backup.sh restore DB_FILE [DATA_FILE]" >&2; exit 1; }
    restore "$2" "${3:-}"
    ;;
  loop)
    while true; do
      now=$(date -u +%s)
      hour=${BACKUP_HOUR:-3}
      wait=$(( (86400 + hour * 3600 - now % 86400) % 86400 ))
      echo "The next backup starts in $wait seconds."
      sleep "$wait"
      backup_once || echo "The backup failed. The next try is in one day." >&2
      sleep 60
    done
    ;;
  *)
    echo "Usage: backup.sh loop | once | restore DB_FILE [DATA_FILE]" >&2
    exit 1
    ;;
esac
