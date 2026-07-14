#!/usr/bin/env bash
set -euo pipefail

source .env

QDRANT_URL="http://localhost:${QDRANT_HTTP_PORT}"

create_collection() {
  local collection_name="$1"

  echo "Criando collection $collection_name..."
  curl -sS -X PUT "$QDRANT_URL/collections/$collection_name" \
    -H "api-key: $QDRANT_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"vectors\": {
        \"size\": $EMBEDDING_VECTOR_SIZE,
        \"distance\": \"Cosine\"
      }
    }" > /dev/null
  echo "Collection $collection_name ok."
}

create_collection "code_symbols"

echo "Collections criadas."
