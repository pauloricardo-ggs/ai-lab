#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="AI Knowledge Platform"

echo ""
echo "======================================"
echo "$PROJECT_NAME - Installer"
echo "======================================"
echo ""

require_command() {
  command -v "$1" >/dev/null 2>&1
}

ask_required() {
  local var_name="$1"
  local prompt="$2"
  local value=""

  while [ -z "$value" ]; do
    read -r -p "$prompt: " value
  done

  echo "$var_name=$value" >> .env
}

ask_default() {
  local var_name="$1"
  local prompt="$2"
  local default_value="$3"
  local value=""

  read -r -p "$prompt [$default_value]: " value
  value="${value:-$default_value}"
  echo "$var_name=$value" >> .env
}

generate_secret() {
  openssl rand -hex 32
}

ensure_env_default() {
  local var_name="$1"
  local value="$2"

  if ! grep -q "^${var_name}=" .env; then
    echo "${var_name}=${value}" >> .env
  fi
}

set_env_value() {
  local var_name="$1"
  local value="$2"
  local tmp_file=""

  tmp_file="$(mktemp)"
  awk -v var_name="$var_name" -v value="$value" '
    BEGIN { replaced = 0 }
    index($0, var_name "=") == 1 {
      print var_name "=" value
      replaced = 1
      next
    }
    { print }
    END {
      if (replaced == 0) {
        print var_name "=" value
      }
    }
  ' .env > "$tmp_file"
  cat "$tmp_file" > .env
  rm "$tmp_file"
}

create_directories() {
  mkdir -p \
    data/postgres/db \
    data/qdrant \
    data/neo4j/data \
    data/neo4j/logs \
    data/neo4j/import \
    data/neo4j/plugins \
    data/open-webui \
    data/ollama \
    data/repos \
    backups
}

install_docker_if_needed() {
  if require_command docker; then
    return
  fi

  echo "Docker nao encontrado. Instalando Docker..."
  sudo apt update
  sudo apt install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt update
  sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER"
  echo ""
  echo "Docker instalado. Esta sessao ainda pode precisar de sudo para acessar o Docker; o instalador continuara usando sudo docker quando necessario."
}

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

env_value() {
  local var_name="$1"
  grep "^${var_name}=" .env | tail -n 1 | cut -d '=' -f2-
}

wait_for_ollama() {
  local attempts=30
  local ollama_port=""

  ollama_port="$(env_value OLLAMA_PORT)"
  ollama_port="${ollama_port:-11434}"

  for _ in $(seq 1 "$attempts"); do
    if curl -fsS "http://localhost:${ollama_port}/api/tags" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  echo "Ollama nao ficou pronto a tempo."
  return 1
}

pull_ollama_model() {
  local model="$1"

  if [ -z "$model" ]; then
    return 0
  fi

  echo "Baixando modelo local: $model"
  docker_cmd exec ai-ollama ollama pull "$model"
}

pull_ollama_models() {
  local chat_model=""
  local embedding_model=""

  chat_model="$(env_value LOCAL_CHAT_MODEL)"
  embedding_model="$(env_value EMBEDDING_MODEL)"

  echo ""
  echo "Aguardando Ollama..."
  wait_for_ollama

  echo ""
  echo "Baixando modelos locais configurados..."
  pull_ollama_model "$chat_model"

  if [ "$embedding_model" != "$chat_model" ]; then
    pull_ollama_model "$embedding_model"
  fi
}

echo "Este script ira preparar o servidor e subir a stack Docker."
echo ""

if [ -f ".env" ]; then
  echo "Arquivo .env ja existe."
  read -r -p "Deseja sobrescrever o .env? [s/N]: " overwrite
  if [[ "$overwrite" != "s" && "$overwrite" != "S" ]]; then
    echo "Mantendo .env existente."
  else
    rm .env
  fi
fi

if [ ! -f ".env" ]; then
  echo ""
  echo "Gerando .env..."
  echo ""

  ask_default "POSTGRES_IMAGE" "Imagem PostgreSQL" "postgres:17.5-alpine"
  ask_default "QDRANT_IMAGE" "Imagem Qdrant" "qdrant/qdrant:v1.17.1"
  ask_default "NEO4J_IMAGE" "Imagem Neo4j" "neo4j:5.26.8"
  ask_default "OPEN_WEBUI_IMAGE" "Imagem Open WebUI" "ghcr.io/open-webui/open-webui:v0.6.15"
  ask_default "OLLAMA_IMAGE" "Imagem Ollama" "ollama/ollama:0.22.1"
  ask_default "NODE_IMAGE" "Imagem Node" "node:22.17.0-alpine"
  ask_default "POSTGRES_PORT" "Porta PostgreSQL" "5432"
  ask_default "QDRANT_HTTP_PORT" "Porta HTTP Qdrant" "6333"
  ask_default "QDRANT_GRPC_PORT" "Porta gRPC Qdrant" "6334"
  ask_default "NEO4J_HTTP_PORT" "Porta HTTP Neo4j" "7474"
  ask_default "NEO4J_BOLT_PORT" "Porta Bolt Neo4j" "7687"
  ask_default "OPEN_WEBUI_PORT" "Porta Open WebUI" "3000"
  ask_default "MCP_GATEWAY_PORT" "Porta MCP Gateway" "7000"
  ask_default "ADMIN_PORT" "Porta Admin UI" "8080"
  ask_default "OLLAMA_PORT" "Porta Ollama" "11434"
  ask_default "POSTGRES_DB" "Nome do banco PostgreSQL" "ai_platform"
  ask_default "POSTGRES_USER" "Usuario PostgreSQL" "ai_platform"
  echo "POSTGRES_PASSWORD=$(generate_secret)" >> .env
  echo "QDRANT_API_KEY=$(generate_secret)" >> .env
  echo "NEO4J_PASSWORD=$(generate_secret)" >> .env
  echo "OPEN_WEBUI_SECRET_KEY=$(generate_secret)" >> .env
  echo "GATEWAY_API_KEY=$(generate_secret)" >> .env
  echo "ADMIN_API_KEY=$(generate_secret)" >> .env
  ask_default "LLM_PROVIDER" "Provider LLM local" "ollama"
  ask_default "LOCAL_CHAT_MODEL" "Modelo local de chat" "qwen2.5:7b-instruct"
  ask_default "EMBEDDING_MODEL" "Modelo local de embedding" "nomic-embed-text"
  ask_default "EMBEDDING_VECTOR_SIZE" "Tamanho do vetor embedding" "768"
  ask_default "GITHUB_TOKEN" "GitHub token opcional (privados: fine-grained Contents Read-only; classic: repo)" ""
  ask_default "GITHUB_OWNER" "GitHub owner/org padrao, opcional" ""
  chmod 600 .env
fi

ensure_env_default "ADMIN_PORT" "8080"
ensure_env_default "ADMIN_API_KEY" "$(generate_secret)"
ensure_env_default "OLLAMA_IMAGE" "ollama/ollama:0.22.1"
ensure_env_default "OLLAMA_PORT" "11434"
ensure_env_default "LLM_PROVIDER" "ollama"
ensure_env_default "LOCAL_CHAT_MODEL" "qwen2.5:7b-instruct"
ensure_env_default "EMBEDDING_MODEL" "nomic-embed-text"
ensure_env_default "EMBEDDING_VECTOR_SIZE" "768"
if grep -q "^LLM_PROVIDER=openai$" .env; then
  set_env_value "LLM_PROVIDER" "ollama"
fi
ensure_env_default "GITHUB_TOKEN" ""
ensure_env_default "GITHUB_OWNER" ""

echo ""
echo "Resumo da instalacao:"
echo ""
sed -E 's/((PASSWORD|KEY|SECRET)[^=]*)=.*/\1=********/g' .env
echo ""

read -r -p "Confirmar instalacao e subir containers? [s/N]: " confirm
if [[ "$confirm" != "s" && "$confirm" != "S" ]]; then
  echo "Instalacao cancelada."
  exit 0
fi

echo ""
echo "Criando diretorios..."
create_directories

echo ""
echo "Verificando Docker..."
install_docker_if_needed

if ! compose_cmd version >/dev/null 2>&1; then
  echo "Docker Compose Plugin nao encontrado."
  exit 1
fi

echo ""
echo "Buildando e subindo containers..."
compose_cmd up -d --build

echo ""
echo "Aguardando servicos iniciarem..."
sleep 15

pull_ollama_models

echo ""
echo "Criando collections no Qdrant..."
chmod +x scripts/create-qdrant-collections.sh
./scripts/create-qdrant-collections.sh

echo ""
echo "Executando health check..."
chmod +x scripts/check-health.sh
./scripts/check-health.sh

SERVER_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "======================================"
echo "Instalacao concluida"
echo "======================================"
echo ""
echo "Open WebUI:"
echo "http://$SERVER_IP:$(grep '^OPEN_WEBUI_PORT=' .env | cut -d '=' -f2)"
echo ""
echo "Admin UI:"
echo "http://$SERVER_IP:$(grep '^ADMIN_PORT=' .env | cut -d '=' -f2)"
echo ""
echo "Qdrant Dashboard:"
echo "http://$SERVER_IP:$(grep '^QDRANT_HTTP_PORT=' .env | cut -d '=' -f2)/dashboard"
echo ""
echo "Neo4j Browser:"
echo "http://$SERVER_IP:$(grep '^NEO4J_HTTP_PORT=' .env | cut -d '=' -f2)"
echo ""
echo "MCP Gateway:"
echo "http://$SERVER_IP:$(grep '^MCP_GATEWAY_PORT=' .env | cut -d '=' -f2)"
echo ""
echo "Ollama:"
echo "http://$SERVER_IP:$(grep '^OLLAMA_PORT=' .env | cut -d '=' -f2)"
echo ""
echo "Proximos passos manuais:"
echo ""
echo "1. Acessar o Open WebUI."
echo "2. Criar o primeiro usuario administrador."
echo "3. Conferir os modelos locais no Open WebUI."
echo "4. Acessar a Admin UI."
echo "5. Criar workspaces e adicionar repositorios."
echo "6. Criar as knowledge bases no Open WebUI."
echo "7. Fazer upload ou sincronizar documentos."
echo "8. Configurar agentes MCP apontando para o gateway."
