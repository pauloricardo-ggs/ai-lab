#!/usr/bin/env bash
set -euo pipefail

source .env

ADMIN_PORT="${ADMIN_PORT:-8080}"
OLLAMA_PORT="${OLLAMA_PORT:-11434}"

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
    return
  fi

  sudo docker "$@"
}

compose_cmd() {
  docker_cmd compose "$@"
}

echo "Verificando containers..."
compose_cmd ps
echo ""

echo "Verificando Open WebUI..."
curl -fsS "http://localhost:${OPEN_WEBUI_PORT}" >/dev/null && echo "Open WebUI OK"
echo ""

echo "Verificando Admin UI..."
curl -fsS "http://localhost:${ADMIN_PORT}/health" >/dev/null && echo "Admin UI OK"
echo ""

echo "Verificando Qdrant..."
curl -fsS "http://localhost:${QDRANT_HTTP_PORT}/collections" \
  -H "api-key: ${QDRANT_API_KEY}" >/dev/null && echo "Qdrant OK"
echo ""

echo "Verificando Ollama..."
curl -fsS "http://localhost:${OLLAMA_PORT}/api/tags" >/dev/null && echo "Ollama OK"
echo ""

echo "Verificando Neo4j..."
curl -fsS "http://localhost:${NEO4J_HTTP_PORT}" >/dev/null && echo "Neo4j OK"
echo ""

echo "Verificando MCP Gateway..."
curl -fsS "http://localhost:${MCP_GATEWAY_PORT}/health" >/dev/null && echo "MCP Gateway OK"
echo ""

echo "Health check finalizado."
