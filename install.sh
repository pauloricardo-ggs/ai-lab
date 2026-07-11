#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="AI Knowledge Platform"
INSTALL_TARGET="linux"
COMPOSE_FILE_ARGS=()

echo ""
echo "======================================"
echo "$PROJECT_NAME - Installer"
echo "======================================"
echo ""

require_command() {
  command -v "$1" >/dev/null 2>&1
}

select_install_target() {
  local choice=""

  echo "Sistema de instalacao:"
  echo "1) Linux/servidor com Ollama em container (padrao)"
  echo "2) macOS Apple Silicon com Ollama nativo no host"
  echo ""

  while true; do
    read -r -p "Escolha [1]: " choice
    choice="${choice:-1}"

    case "$choice" in
      1|linux|Linux|LINUX)
        INSTALL_TARGET="linux"
        COMPOSE_FILE_ARGS=()
        return
        ;;
      2|mac|Mac|MAC|macos|macOS)
        INSTALL_TARGET="mac"
        COMPOSE_FILE_ARGS=(-f docker-compose.mac.yml)
        return
        ;;
      *)
        echo "Opcao invalida. Use 1 para Linux ou 2 para macOS."
        ;;
    esac
  done
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

detect_server_host() {
  if hostname -I >/dev/null 2>&1; then
    hostname -I | awk '{print $1}'
    return
  fi

  echo "localhost"
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

is_sensitive_var() {
  [[ "$1" == *_PASSWORD || "$1" == *_SECRET || "$1" == *_KEY || "$1" == *_TOKEN ]]
}

mask_value() {
  local value="$1"
  if [ -z "$value" ]; then
    echo ""
  elif [ "${#value}" -le 8 ]; then
    echo "********"
  else
    echo "${value:0:4}********${value: -4}"
  fi
}

should_prompt_env_var() {
  local var_name="$1"

  if [ "$INSTALL_TARGET" = "mac" ]; then
    [[ "$var_name" == "OLLAMA_IMAGE" || "$var_name" == "OLLAMA_PORT" || "$var_name" == "OLLAMA_BASE_URL" ]] && return 1
  fi

  return 0
}

prompt_existing_env_values() {
  local line var example_value current display value
  while IFS= read -r line <&3 || [ -n "$line" ]; do
    [[ "$line" =~ ^[[:space:]]*# || -z "$line" || "$line" != *=* ]] && continue
    var="${line%%=*}"
    should_prompt_env_var "$var" || continue
    example_value="${line#*=}"
    current="$(env_value "$var")"
    if [ -z "$current" ]; then current="$example_value"; fi
    display="$current"
    if is_sensitive_var "$var"; then display="$(mask_value "$current")"; fi
    # A lista de campos usa o descritor 3; a resposta deve sempre vir do terminal.
    # Sem isso, `read` consome a proxima linha do .env.example e corrompe valores.
    read -r -p "$var [$display]: " value < /dev/tty
    if [ -n "$value" ]; then
      set_env_value "$var" "$value"
    fi
  done 3< .env.example
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

  if [ "$INSTALL_TARGET" = "mac" ]; then
    echo "Docker nao encontrado. No macOS, instale e inicie o Docker Desktop antes de continuar."
    exit 1
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
  docker_cmd compose "${COMPOSE_FILE_ARGS[@]}" "$@"
}

env_value() {
  local var_name="$1"
  grep "^${var_name}=" .env | tail -n 1 | cut -d '=' -f2-
}

wait_for_ollama() {
  local attempts=30
  local ollama_url=""
  local ollama_port=""

  if [ "$INSTALL_TARGET" = "mac" ]; then
    ollama_url="http://localhost:11434"
  else
    ollama_port="$(env_value OLLAMA_PORT)"
    ollama_port="${ollama_port:-11434}"
    ollama_url="http://localhost:${ollama_port}"
  fi

  for _ in $(seq 1 "$attempts"); do
    if curl -fsS "${ollama_url}/api/tags" >/dev/null 2>&1; then
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

  if [ "$INSTALL_TARGET" = "mac" ]; then
    echo "Modo macOS: usando Ollama nativo do host. O instalador nao baixa modelos nem cria container Ollama."
    echo "Confirme no host que os modelos configurados existem: $chat_model e $embedding_model"
    return 0
  fi

  echo ""
  echo "Baixando modelos locais configurados..."
  pull_ollama_model "$chat_model"

  if [ "$embedding_model" != "$chat_model" ]; then
    pull_ollama_model "$embedding_model"
  fi
}

echo "Este script ira preparar o servidor e subir a stack Docker."
echo ""

select_install_target
echo "Alvo selecionado: $INSTALL_TARGET"
echo ""

updating_existing_env=false
if [ -f ".env" ]; then
  echo "Arquivo .env ja existe."
  read -r -p "Deseja atualizar configuracoes mantendo os valores atuais? [s/N]: " update_existing
  if [[ "$update_existing" == "s" || "$update_existing" == "S" ]]; then
    updating_existing_env=true
    cp .env ".env.before-update.$(date +%Y%m%d%H%M%S)"
    echo "Backup criado antes da edicao do .env."
  fi
fi

if [ ! -f ".env" ]; then
  echo ""
  echo "Gerando .env..."
  echo ""

  ask_default "POSTGRES_IMAGE" "Imagem PostgreSQL" "postgres:17.5-alpine"
  ask_default "QDRANT_IMAGE" "Imagem Qdrant" "qdrant/qdrant:v1.17.1"
  ask_default "NEO4J_IMAGE" "Imagem Neo4j" "neo4j:5.26.8"
  ask_default "OPEN_WEBUI_IMAGE" "Imagem Open WebUI" "ghcr.io/open-webui/open-webui:v0.10.2"
  if [ "$INSTALL_TARGET" = "linux" ]; then
    ask_default "OLLAMA_IMAGE" "Imagem Ollama" "ollama/ollama:0.22.1"
  fi
  ask_default "NODE_IMAGE" "Imagem Node" "node:22.17.0-alpine"
  ask_default "DOTNET_SDK_IMAGE" "Imagem .NET SDK" "mcr.microsoft.com/dotnet/sdk:8.0"
  ask_default "DOTNET_ASPNET_IMAGE" "Imagem .NET ASP.NET" "mcr.microsoft.com/dotnet/aspnet:8.0"
  ask_default "POSTGRES_PORT" "Porta PostgreSQL" "5432"
  ask_default "QDRANT_HTTP_PORT" "Porta HTTP Qdrant" "6333"
  ask_default "QDRANT_GRPC_PORT" "Porta gRPC Qdrant" "6334"
  ask_default "NEO4J_HTTP_PORT" "Porta HTTP Neo4j" "7474"
  ask_default "NEO4J_BOLT_PORT" "Porta Bolt Neo4j" "7687"
  ask_default "OPEN_WEBUI_PORT" "Porta Open WebUI" "3000"
  ask_default "MCP_GATEWAY_PORT" "Porta MCP Gateway" "7000"
  ask_default "ADMIN_PORT" "Porta Admin UI" "8080"
  if [ "$INSTALL_TARGET" = "mac" ]; then
    echo "OLLAMA_BASE_URL=http://host.docker.internal:11434" >> .env
  else
    ask_default "OLLAMA_PORT" "Porta Ollama" "11434"
    ask_default "OLLAMA_BASE_URL" "URL interna do Ollama para os containers" "http://ollama:11434"
  fi
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
ensure_env_default "POSTGRES_PASSWORD" "$(generate_secret)"
ensure_env_default "QDRANT_API_KEY" "$(generate_secret)"
ensure_env_default "NEO4J_PASSWORD" "$(generate_secret)"
ensure_env_default "OPEN_WEBUI_SECRET_KEY" "$(generate_secret)"
ensure_env_default "GATEWAY_API_KEY" "$(generate_secret)"
ensure_env_default "OLLAMA_IMAGE" "ollama/ollama:0.22.1"
ensure_env_default "NODE_IMAGE" "node:22.17.0-alpine"
ensure_env_default "DOTNET_SDK_IMAGE" "mcr.microsoft.com/dotnet/sdk:8.0"
ensure_env_default "DOTNET_ASPNET_IMAGE" "mcr.microsoft.com/dotnet/aspnet:8.0"
ensure_env_default "OLLAMA_PORT" "11434"
ensure_env_default "OLLAMA_BASE_URL" "http://ollama:11434"
if [ "$INSTALL_TARGET" = "mac" ]; then
  set_env_value "OLLAMA_BASE_URL" "http://host.docker.internal:11434"
fi
ensure_env_default "LLM_PROVIDER" "ollama"
ensure_env_default "LOCAL_CHAT_MODEL" "qwen2.5:7b-instruct"
ensure_env_default "EMBEDDING_MODEL" "nomic-embed-text"
ensure_env_default "EMBEDDING_VECTOR_SIZE" "768"
ensure_env_default "EMBEDDING_MAX_CHARS" "6000"
ensure_env_default "EMBEDDING_MAX_LINES" "80"
ensure_env_default "EMBEDDING_TIMEOUT_MS" "120000"
ensure_env_default "EMBEDDING_MAX_RETRIES" "2"
ensure_env_default "ROSLYN_TIMEOUT_MS" "45000"
ensure_env_default "NEO4J_TIMEOUT_MS" "60000"
ensure_env_default "INDEX_FILE_TIMEOUT_MS" "300000"
ensure_env_default "INDEX_MAX_CONCURRENT_REPOSITORIES" "1"
ensure_env_default "INDEX_IGNORE_MIGRATIONS" "true"
if grep -q "^LLM_PROVIDER=openai$" .env; then
  set_env_value "LLM_PROVIDER" "ollama"
fi
ensure_env_default "GITHUB_TOKEN" ""
ensure_env_default "GITHUB_OWNER" ""

if [ "$updating_existing_env" = true ]; then
  echo "Pressione Enter para manter cada valor atual. Valores sensiveis sao mascarados."
  prompt_existing_env_values
  read -r -p "Regenerar secrets existentes (senhas e chaves)? [s/N]: " regenerate_secrets
  if [[ "$regenerate_secrets" == "s" || "$regenerate_secrets" == "S" ]]; then
    set_env_value "POSTGRES_PASSWORD" "$(generate_secret)"
    set_env_value "QDRANT_API_KEY" "$(generate_secret)"
    set_env_value "NEO4J_PASSWORD" "$(generate_secret)"
    set_env_value "OPEN_WEBUI_SECRET_KEY" "$(generate_secret)"
    set_env_value "GATEWAY_API_KEY" "$(generate_secret)"
    set_env_value "ADMIN_API_KEY" "$(generate_secret)"
    echo "Secrets regenerados por solicitacao explicita."
  fi
fi

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
if [ "$INSTALL_TARGET" = "mac" ]; then
  INSTALL_TARGET="$INSTALL_TARGET" COMPOSE_FILE="docker-compose.mac.yml" ./scripts/check-health.sh
else
  INSTALL_TARGET="$INSTALL_TARGET" ./scripts/check-health.sh
fi

SERVER_IP="$(detect_server_host)"

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
if [ "$INSTALL_TARGET" = "mac" ]; then
  echo "$(grep '^OLLAMA_BASE_URL=' .env | tail -n 1 | cut -d '=' -f2-)"
else
  echo "http://$SERVER_IP:$(grep '^OLLAMA_PORT=' .env | cut -d '=' -f2)"
fi
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
