#!/usr/bin/env bash
set -euo pipefail

source .env

ADMIN_PORT="${ADMIN_PORT:-8080}"
OLLAMA_PORT="${OLLAMA_PORT:-11434}"
INSTALL_TARGET="${INSTALL_TARGET:-linux}"

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

echo "Verificando Docling..."
curl -fsS "http://localhost:${DOCLING_PORT:-5001}/docs" >/dev/null && echo "Docling OK"
echo ""

echo "Verificando Admin UI..."
curl -fsS "http://localhost:${ADMIN_PORT}/health" >/dev/null && echo "Admin UI OK"
echo ""

echo "Verificando Qdrant..."
curl -fsS "http://localhost:${QDRANT_HTTP_PORT}/collections" \
  -H "api-key: ${QDRANT_API_KEY}" >/dev/null && echo "Qdrant OK"
echo ""

echo "Verificando Ollama..."
if [ "$INSTALL_TARGET" = "mac" ]; then
  OLLAMA_HEALTH_URL="http://localhost:11434"
else
  OLLAMA_HEALTH_URL="http://localhost:${OLLAMA_PORT}"
fi
curl -fsS "${OLLAMA_HEALTH_URL}/api/tags" >/dev/null && echo "Ollama OK"
echo ""

echo "Verificando Neo4j..."
curl -fsS "http://localhost:${NEO4J_HTTP_PORT}" >/dev/null && echo "Neo4j OK"
echo ""

echo "Verificando MCP Gateway..."
curl -fsS -X POST "http://localhost:${MCP_GATEWAY_PORT}/mcp" \
  -H "Authorization: Bearer ${GATEWAY_API_KEY}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":"health","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"health-check","version":"1.0.0"}}}' >/dev/null && echo "MCP Gateway OK"
echo ""

echo "Health check finalizado."
