#!/usr/bin/env bash
set -euo pipefail

usage() { echo "Uso: $0 [--verify-only] [--yes] <diretorio-backup>"; }
VERIFY_ONLY=false
CONFIRM=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --verify-only) VERIFY_ONLY=true ;;
    --yes) CONFIRM=true ;;
    -h|--help) usage; exit 0 ;;
    *) BACKUP_DIR="$1" ;;
  esac
  shift
done
: "${BACKUP_DIR:?Informe o diretorio do backup}"

required=(manifest.txt SHA256SUMS postgres.sql qdrant.tar.gz neo4j.tar.gz open-webui.tar.gz)
for file in "${required[@]}"; do
  [[ -f "$BACKUP_DIR/$file" ]] || { echo "Arquivo ausente: $file" >&2; exit 2; }
done
grep -qx 'format=ai-platform-backup-v1' "$BACKUP_DIR/manifest.txt"
(cd "$BACKUP_DIR" && shasum -a 256 -c SHA256SUMS)
for archive in qdrant.tar.gz neo4j.tar.gz open-webui.tar.gz; do tar -tzf "$BACKUP_DIR/$archive" >/dev/null; done
grep -Eq '(PostgreSQL database dump|^CREATE |^COPY |^-- Dumped)' "$BACKUP_DIR/postgres.sql" || { echo "Dump PostgreSQL invalido" >&2; exit 2; }
echo "Backup verificado: $BACKUP_DIR"
$VERIFY_ONLY && exit 0
$CONFIRM || { echo "Restore altera dados. Execute novamente com --yes." >&2; exit 3; }

source "${ENV_FILE:-.env}"
docker_cmd() { if docker info >/dev/null 2>&1; then docker "$@"; else sudo docker "$@"; fi; }
echo "Parando servicos com estado..."
docker_cmd compose stop admin open-webui qdrant neo4j

restore_archive() {
  local archive="$1" target="$2"
  local staging
  staging=$(mktemp -d "${TMPDIR:-/tmp}/ai-restore.XXXXXX")
  tar -xzf "$BACKUP_DIR/$archive" -C "$staging"
  mkdir -p "$target"
  find "$target" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  local source="$staging/${target#./}"
  [[ -d "$source" ]] || { echo "Layout inesperado em $archive" >&2; exit 2; }
  cp -a "$source/." "$target/"
  rm -rf "$staging"
}

restore_archive qdrant.tar.gz ./data/qdrant
restore_archive neo4j.tar.gz ./data/neo4j
restore_archive open-webui.tar.gz ./data/open-webui
docker_cmd compose up -d postgres
until docker_cmd exec ai-postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do sleep 2; done
docker_cmd exec -i ai-postgres psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE);"
docker_cmd exec -i ai-postgres psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE \"$POSTGRES_DB\";"
docker_cmd exec -i ai-postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB" < "$BACKUP_DIR/postgres.sql"
docker_cmd compose up -d
echo "Restore concluido. Execute ./scripts/check-health.sh"
