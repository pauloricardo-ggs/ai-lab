#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/restore-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/source/data/qdrant" "$tmp/source/data/neo4j" "$tmp/source/data/open-webui" "$tmp/backup"
touch "$tmp/source/data/qdrant/state" "$tmp/source/data/neo4j/state" "$tmp/source/data/open-webui/state"
(cd "$tmp/source" && tar -czf "$tmp/backup/qdrant.tar.gz" ./data/qdrant && tar -czf "$tmp/backup/neo4j.tar.gz" ./data/neo4j && tar -czf "$tmp/backup/open-webui.tar.gz" ./data/open-webui)
printf '%s\n' '-- PostgreSQL database dump' 'CREATE TABLE restore_probe(id integer);' > "$tmp/backup/postgres.sql"
printf '%s\n' 'format=ai-platform-backup-v1' 'created_at=2026-01-01T00:00:00Z' > "$tmp/backup/manifest.txt"
(cd "$tmp/backup" && shasum -a 256 postgres.sql qdrant.tar.gz neo4j.tar.gz open-webui.tar.gz > SHA256SUMS)
"$root/scripts/restore.sh" --verify-only "$tmp/backup" | grep -q 'Backup verificado'
printf 'corruption' >> "$tmp/backup/postgres.sql"
if "$root/scripts/restore.sh" --verify-only "$tmp/backup" >/dev/null 2>&1; then
  echo 'restore aceitou backup corrompido' >&2; exit 1
fi
echo 'restore verification test: ok'
