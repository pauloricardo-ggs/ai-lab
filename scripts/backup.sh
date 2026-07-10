#!/usr/bin/env bash
set -euo pipefail

source .env

BACKUP_DIR="./backups/$(date +%F_%H-%M-%S)"
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

echo "Backup concluido em $BACKUP_DIR"
