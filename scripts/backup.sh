#!/usr/bin/env bash
set -euo pipefail

source "${ENV_FILE:-.env}"

BACKUP_ROOT="${BACKUP_ROOT:-./backups}"
BACKUP_DIR="$BACKUP_ROOT/$(date +%F_%H-%M-%S)"
mkdir -p "$BACKUP_DIR"

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
    return
  fi

  sudo docker "$@"
}

echo "Backup PostgreSQL..."
docker_cmd exec ai-postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "$BACKUP_DIR/postgres.sql"

echo "Backup Qdrant..."
tar -czf "$BACKUP_DIR/qdrant.tar.gz" ./data/qdrant

echo "Backup Neo4j..."
tar -czf "$BACKUP_DIR/neo4j.tar.gz" ./data/neo4j

echo "Backup Open WebUI..."
tar -czf "$BACKUP_DIR/open-webui.tar.gz" ./data/open-webui

cat > "$BACKUP_DIR/manifest.txt" <<EOF
format=ai-platform-backup-v1
created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
postgres_database=$POSTGRES_DB
EOF
(cd "$BACKUP_DIR" && shasum -a 256 postgres.sql qdrant.tar.gz neo4j.tar.gz open-webui.tar.gz > SHA256SUMS)

echo "Backup concluido em $BACKUP_DIR"
