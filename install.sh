#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="AI Knowledge Platform"
INSTALL_TARGET="linux"
COMPOSE_FILE_ARGS=()
CURRENT_STEP=0
TOTAL_STEPS=5

# Cores somente quando a saida estiver ligada a um terminal. Isso mantem logs
# legiveis em CI, redirecionamentos e ferramentas de automacao.
if [ -t 1 ] && [ "${NO_COLOR:-}" != "1" ]; then
  RESET=$'\033[0m'
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  BLUE=$'\033[38;5;39m'
  GREEN=$'\033[38;5;42m'
  YELLOW=$'\033[38;5;220m'
  RED=$'\033[38;5;203m'
else
  RESET=""; BOLD=""; DIM=""; BLUE=""; GREEN=""; YELLOW=""; RED=""
fi

line() { printf '%*s\n' 64 '' | tr ' ' '─'; }
title() { printf '\n%s%s%s\n%s%s%s\n' "$BOLD$BLUE" "$1" "$RESET" "$DIM" "$(line)" "$RESET"; }
step() {
  CURRENT_STEP=$((CURRENT_STEP + 1))
  printf '\n%s[%d/%d]%s %s%s%s\n' "$BLUE$BOLD" "$CURRENT_STEP" "$TOTAL_STEPS" "$RESET" "$BOLD" "$1" "$RESET"
}
info() { printf '%s›%s %s\n' "$BLUE" "$RESET" "$1"; }
success() { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warning() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
fail() { printf '%sErro:%s %s\n' "$RED$BOLD" "$RESET" "$1" >&2; }
ask() { local prompt="$1"; read -r -p "${BLUE}?${RESET} ${prompt}" "${@:2}"; }

on_error() {
  local exit_code=$?
  printf '\n'
  fail "A instalacao foi interrompida. Revise a mensagem acima e execute novamente quando estiver pronto."
  exit "$exit_code"
}
trap on_error ERR

clear 2>/dev/null || true
printf '%s  AI Knowledge Platform%s\n' "$BOLD$BLUE" "$RESET"
printf '%s  Local AI · Knowledge · Developer tools%s\n' "$BLUE" "$RESET"
printf '%sInstalador interativo%s  ·  infraestrutura local pronta para uso\n\n' "$DIM" "$RESET"

require_command() {
  command -v "$1" >/dev/null 2>&1
}

select_install_target() {
  local choice=""

  title "Escolha o ambiente"
  printf '  %s1%s  Linux ou servidor %s(recomendado)%s\n' "$BOLD" "$RESET" "$DIM" "$RESET"
  printf '     Ollama sera executado em um container Docker.\n\n'
  printf '  %s2%s  macOS com Apple Silicon\n' "$BOLD" "$RESET"
  printf '     Usa o Ollama instalado e em execucao no computador.\n\n'

  while true; do
    ask "Ambiente [1]: " choice
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
        warning "Opcao invalida. Escolha 1 para Linux ou 2 para macOS."
        ;;
    esac
  done
}

ask_required() {
  local var_name="$1"
  local prompt="$2"
  local value=""

  while [ -z "$value" ]; do
    ask "$prompt: " value
  done

  echo "$var_name=$value" >> .env
}

ask_default() {
  local var_name="$1"
  local prompt="$2"
  local default_value="$3"
  local value=""

  ask "$prompt [$default_value]: " value
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

  [[ "$var_name" == *_IMAGE ]] && return 1
  [[ "$var_name" == *_TIMEOUT_MS ]] && return 1
  [[ "$var_name" == "INDEX_MAX_CONCURRENT_REPOSITORIES" ]] && return 1
  [[ "$var_name" == "GATEWAY_WORKSPACE_KEYS_JSON" ]] && return 1
  [[ "$var_name" == REPOSITORY_RECONCILER_* ]] && return 1
  [[ "$var_name" == "RAG_EMBEDDING_QUERY_PREFIX" ]] && return 1
  [[ "$var_name" == *_PORT ]] && return 1

  if [ "$INSTALL_TARGET" = "mac" ]; then
    [[ "$var_name" == "OLLAMA_IMAGE" || "$var_name" == "OLLAMA_PORT" || "$var_name" == "OLLAMA_BASE_URL" ]] && return 1
  fi

  return 0
}

is_supported_env_var() {
  case "$1" in
    POSTGRES_IMAGE|QDRANT_IMAGE|NEO4J_IMAGE|OPEN_WEBUI_IMAGE|DOCLING_IMAGE|OLLAMA_IMAGE|NODE_IMAGE|DOTNET_SDK_IMAGE|DOTNET_ASPNET_IMAGE|POSTGRES_PORT|QDRANT_HTTP_PORT|QDRANT_GRPC_PORT|NEO4J_HTTP_PORT|NEO4J_BOLT_PORT|OPEN_WEBUI_PORT|DOCLING_PORT|MCP_GATEWAY_PORT|ADMIN_PORT|OLLAMA_PORT|POSTGRES_PASSWORD|QDRANT_API_KEY|NEO4J_PASSWORD|OPEN_WEBUI_SECRET_KEY|GATEWAY_API_KEY|GATEWAY_WORKSPACE_KEYS_JSON|ADMIN_API_KEY|LOCAL_CHAT_MODEL|EMBEDDING_MODEL|EMBEDDING_VECTOR_SIZE|RAG_EMBEDDING_QUERY_PREFIX|EMBEDDING_TIMEOUT_MS|ROSLYN_TIMEOUT_MS|NEO4J_TIMEOUT_MS|INDEX_FILE_TIMEOUT_MS|INDEX_MAX_CONCURRENT_REPOSITORIES|RESEARCH_SESSION_TTL_MS|REPOSITORY_RECONCILER_ENABLED|REPOSITORY_RECONCILER_INTERVAL_MINUTES|REPOSITORY_RECONCILER_INITIAL_DELAY_SECONDS|GITHUB_TOKEN|GITHUB_OWNER)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

remove_legacy_env_vars() {
  local tmp_file=""
  tmp_file="$(mktemp)"

  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      is_supported_env_var "${line%%=*}" && echo "$line" >> "$tmp_file"
    else
      echo "$line" >> "$tmp_file"
    fi
  done < .env

  cat "$tmp_file" > .env
  rm "$tmp_file"
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
    ask "$var [$display]: " value < /dev/tty
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
    data/docling \
    data/ollama \
    data/repos \
    backups
}

install_docker_if_needed() {
  if require_command docker; then
    return
  fi

  if [ "$INSTALL_TARGET" = "mac" ]; then
    fail "Docker nao encontrado. No macOS, instale e inicie o Docker Desktop antes de continuar."
    exit 1
  fi

  info "Docker nao encontrado. A instalacao oficial do Docker sera iniciada."
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
  success "Docker instalado. O instalador usara sudo quando necessario nesta sessao."
}

preflight_check() {
  local missing=()

  require_command openssl || missing+=(openssl)
  require_command curl || missing+=(curl)
  [ -f docker-compose.yml ] || missing+=(docker-compose.yml)
  [ -f .env.example ] || missing+=(.env.example)

  if [ "${#missing[@]}" -gt 0 ]; then
    fail "Itens obrigatorios ausentes: ${missing[*]}"
    exit 1
  fi

  success "Arquivos e ferramentas basicas verificados"
}

show_install_summary() {
  local current_action="Nova configuracao"
  [ -f .env ] && current_action="Atualizacao da configuracao existente"

  title "Resumo antes de continuar"
  printf '  %-18s %s\n' "Ambiente" "$INSTALL_TARGET"
  printf '  %-18s %s\n' "Operacao" "$current_action"
  printf '  %-18s %s\n' "Chat" "$(env_value LOCAL_CHAT_MODEL)"
  printf '  %-18s %s\n' "Embeddings" "$(env_value EMBEDDING_MODEL)"
  printf '\n%s  A stack sera criada/atualizada e os servicos serao iniciados.%s\n\n' "$DIM" "$RESET"
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

info "Este assistente prepara a infraestrutura, configura os servicos e valida a saude da stack."
info "Voce podera revisar a configuracao antes de iniciar os containers."
select_install_target
success "Ambiente selecionado: $INSTALL_TARGET"

step "Validando o ambiente"
preflight_check

updating_existing_env=false
if [ -f ".env" ]; then
  warning "Uma configuracao existente foi encontrada."
  ask "Atualizar mantendo os valores atuais? [s/N]: " update_existing
  if [[ "$update_existing" == "s" || "$update_existing" == "S" ]]; then
    updating_existing_env=true
    cp .env ".env.before-update.$(date +%Y%m%d%H%M%S)"
    success "Backup do .env criado antes da edicao"
  fi
fi

if [ ! -f ".env" ]; then
  step "Criando a configuracao"
  info "Os segredos serao gerados automaticamente e gravados com permissao restrita."

  echo "POSTGRES_IMAGE=postgres:17.5-alpine" >> .env
  echo "QDRANT_IMAGE=qdrant/qdrant:v1.17.1" >> .env
  echo "NEO4J_IMAGE=neo4j:5.26.8" >> .env
  echo "OPEN_WEBUI_IMAGE=ghcr.io/open-webui/open-webui:v0.10.2" >> .env
  echo "DOCLING_IMAGE=quay.io/docling-project/docling-serve:v1.18.0" >> .env
  echo "OLLAMA_IMAGE=ollama/ollama:0.22.1" >> .env
  echo "NODE_IMAGE=node:22.17.0-alpine" >> .env
  echo "DOTNET_SDK_IMAGE=mcr.microsoft.com/dotnet/sdk:8.0" >> .env
  echo "DOTNET_ASPNET_IMAGE=mcr.microsoft.com/dotnet/aspnet:8.0" >> .env
  echo "POSTGRES_PORT=5432" >> .env
  echo "QDRANT_HTTP_PORT=6333" >> .env
  echo "QDRANT_GRPC_PORT=6334" >> .env
  echo "NEO4J_HTTP_PORT=7474" >> .env
  echo "NEO4J_BOLT_PORT=7687" >> .env
  echo "OPEN_WEBUI_PORT=3000" >> .env
  echo "DOCLING_PORT=5001" >> .env
  echo "MCP_GATEWAY_PORT=7000" >> .env
  echo "ADMIN_PORT=8080" >> .env
  echo "OLLAMA_PORT=11434" >> .env
  echo "POSTGRES_PASSWORD=$(generate_secret)" >> .env
  echo "QDRANT_API_KEY=$(generate_secret)" >> .env
  echo "NEO4J_PASSWORD=$(generate_secret)" >> .env
  echo "OPEN_WEBUI_SECRET_KEY=$(generate_secret)" >> .env
  echo "GATEWAY_API_KEY=$(generate_secret)" >> .env
  echo "GATEWAY_WORKSPACE_KEYS_JSON=" >> .env
  echo "ADMIN_API_KEY=$(generate_secret)" >> .env
  ask_default "LOCAL_CHAT_MODEL" "Modelo local de chat" "qwen2.5:7b-instruct"
  ask_default "EMBEDDING_MODEL" "Modelo local de embedding" "qwen3-embedding:0.6b"
  ask_default "EMBEDDING_VECTOR_SIZE" "Tamanho do vetor embedding" "1024"
  echo 'RAG_EMBEDDING_QUERY_PREFIX="Instruct: Given a question in Portuguese or English, retrieve the passages from internal business and technical documents that best support a precise and factual answer.\nQuery: "' >> .env
  echo "EMBEDDING_TIMEOUT_MS=300000" >> .env
  echo "ROSLYN_TIMEOUT_MS=120000" >> .env
  echo "NEO4J_TIMEOUT_MS=120000" >> .env
  echo "INDEX_FILE_TIMEOUT_MS=1200000" >> .env
  echo "INDEX_MAX_CONCURRENT_REPOSITORIES=1" >> .env
  echo "RESEARCH_SESSION_TTL_MS=1200000" >> .env
  echo "REPOSITORY_RECONCILER_ENABLED=true" >> .env
  echo "REPOSITORY_RECONCILER_INTERVAL_MINUTES=60" >> .env
  echo "REPOSITORY_RECONCILER_INITIAL_DELAY_SECONDS=60" >> .env
  ask_default "GITHUB_TOKEN" "GitHub token opcional (privados: fine-grained Contents Read-only; classic: repo)" ""
  ask_default "GITHUB_OWNER" "GitHub owner/org padrao, opcional" ""
  chmod 600 .env
  success "Arquivo .env criado com seguranca"
fi

ensure_env_default "ADMIN_API_KEY" "$(generate_secret)"
ensure_env_default "POSTGRES_IMAGE" "postgres:17.5-alpine"
ensure_env_default "QDRANT_IMAGE" "qdrant/qdrant:v1.17.1"
ensure_env_default "NEO4J_IMAGE" "neo4j:5.26.8"
ensure_env_default "OPEN_WEBUI_IMAGE" "ghcr.io/open-webui/open-webui:v0.10.2"
ensure_env_default "DOCLING_IMAGE" "quay.io/docling-project/docling-serve:v1.18.0"
ensure_env_default "OLLAMA_IMAGE" "ollama/ollama:0.22.1"
ensure_env_default "NODE_IMAGE" "node:22.17.0-alpine"
ensure_env_default "DOTNET_SDK_IMAGE" "mcr.microsoft.com/dotnet/sdk:8.0"
ensure_env_default "DOTNET_ASPNET_IMAGE" "mcr.microsoft.com/dotnet/aspnet:8.0"
ensure_env_default "POSTGRES_PORT" "5432"
ensure_env_default "QDRANT_HTTP_PORT" "6333"
ensure_env_default "QDRANT_GRPC_PORT" "6334"
ensure_env_default "NEO4J_HTTP_PORT" "7474"
ensure_env_default "NEO4J_BOLT_PORT" "7687"
ensure_env_default "OPEN_WEBUI_PORT" "3000"
ensure_env_default "DOCLING_PORT" "5001"
ensure_env_default "MCP_GATEWAY_PORT" "7000"
ensure_env_default "ADMIN_PORT" "8080"
ensure_env_default "OLLAMA_PORT" "11434"
ensure_env_default "POSTGRES_PASSWORD" "$(generate_secret)"
ensure_env_default "QDRANT_API_KEY" "$(generate_secret)"
ensure_env_default "NEO4J_PASSWORD" "$(generate_secret)"
ensure_env_default "OPEN_WEBUI_SECRET_KEY" "$(generate_secret)"
ensure_env_default "GATEWAY_API_KEY" "$(generate_secret)"
ensure_env_default "GATEWAY_WORKSPACE_KEYS_JSON" ""
ensure_env_default "LOCAL_CHAT_MODEL" "qwen2.5:7b-instruct"
ensure_env_default "EMBEDDING_MODEL" "qwen3-embedding:0.6b"
ensure_env_default "EMBEDDING_VECTOR_SIZE" "1024"
ensure_env_default "RAG_EMBEDDING_QUERY_PREFIX" '"Instruct: Given a question in Portuguese or English, retrieve the passages from internal business and technical documents that best support a precise and factual answer.\nQuery: "'
ensure_env_default "EMBEDDING_TIMEOUT_MS" "300000"
ensure_env_default "ROSLYN_TIMEOUT_MS" "120000"
ensure_env_default "NEO4J_TIMEOUT_MS" "120000"
ensure_env_default "INDEX_FILE_TIMEOUT_MS" "1200000"
ensure_env_default "INDEX_MAX_CONCURRENT_REPOSITORIES" "1"
ensure_env_default "RESEARCH_SESSION_TTL_MS" "1200000"
ensure_env_default "REPOSITORY_RECONCILER_ENABLED" "true"
ensure_env_default "REPOSITORY_RECONCILER_INTERVAL_MINUTES" "60"
ensure_env_default "REPOSITORY_RECONCILER_INITIAL_DELAY_SECONDS" "60"
ensure_env_default "GITHUB_TOKEN" ""
ensure_env_default "GITHUB_OWNER" ""

remove_legacy_env_vars

if [ "$updating_existing_env" = true ]; then
  step "Revisando configuracao existente"
  info "Pressione Enter para manter cada valor. Valores sensiveis aparecem mascarados."
  prompt_existing_env_values
  ask "Regenerar senhas e chaves existentes? [s/N]: " regenerate_secrets
  if [[ "$regenerate_secrets" == "s" || "$regenerate_secrets" == "S" ]]; then
    set_env_value "POSTGRES_PASSWORD" "$(generate_secret)"
    set_env_value "QDRANT_API_KEY" "$(generate_secret)"
    set_env_value "NEO4J_PASSWORD" "$(generate_secret)"
    set_env_value "OPEN_WEBUI_SECRET_KEY" "$(generate_secret)"
    set_env_value "GATEWAY_API_KEY" "$(generate_secret)"
    set_env_value "ADMIN_API_KEY" "$(generate_secret)"
    success "Senhas e chaves regeneradas"
  fi
fi

show_install_summary
ask "Iniciar a instalacao agora? [s/N]: " confirm
if [[ "$confirm" != "s" && "$confirm" != "S" ]]; then
  info "A infraestrutura nao foi iniciada. Instalacao cancelada."
  exit 0
fi

step "Preparando armazenamento e Docker"
info "Criando diretorios persistentes..."
create_directories
success "Diretorios prontos"

info "Verificando Docker..."
install_docker_if_needed

if ! compose_cmd version >/dev/null 2>&1; then
  fail "Docker Compose Plugin nao encontrado. Instale-o e execute o instalador novamente."
  exit 1
fi
success "Docker Compose disponivel"

step "Construindo e iniciando servicos"
info "Isso pode levar alguns minutos na primeira execucao."
compose_cmd up -d --build
success "Containers iniciados"

info "Aguardando servicos iniciarem..."
sleep 15

pull_ollama_models

step "Finalizando e validando"
info "Criando collections no Qdrant..."
chmod +x scripts/create-qdrant-collections.sh
./scripts/create-qdrant-collections.sh

info "Executando verificacao de saude..."
chmod +x scripts/check-health.sh
if [ "$INSTALL_TARGET" = "mac" ]; then
  INSTALL_TARGET="$INSTALL_TARGET" COMPOSE_FILE="docker-compose.mac.yml" ./scripts/check-health.sh
else
  INSTALL_TARGET="$INSTALL_TARGET" ./scripts/check-health.sh
fi

SERVER_IP="$(detect_server_host)"

title "Instalacao concluida"
success "Todos os servicos essenciais responderam ao health check"
printf '\n%sAcessos locais%s\n\n' "$BOLD" "$RESET"
printf '  %-18s %s\n' "Open WebUI" "http://$SERVER_IP:$(env_value OPEN_WEBUI_PORT)"
printf '  %-18s %s\n' "Admin UI" "http://$SERVER_IP:$(env_value ADMIN_PORT)"
printf '  %-18s %s\n' "Qdrant Dashboard" "http://$SERVER_IP:$(env_value QDRANT_HTTP_PORT)/dashboard"
printf '  %-18s %s\n' "Neo4j Browser" "http://$SERVER_IP:$(env_value NEO4J_HTTP_PORT)"
printf '  %-18s %s\n' "MCP Gateway" "http://$SERVER_IP:$(env_value MCP_GATEWAY_PORT)"
printf '  %-18s ' "Ollama"
if [ "$INSTALL_TARGET" = "mac" ]; then
  echo "http://localhost:11434"
else
  echo "http://$SERVER_IP:$(env_value OLLAMA_PORT)"
fi
printf '\n%sProximos passos%s\n' "$BOLD" "$RESET"
printf '  1. Acesse o Open WebUI e crie o primeiro usuario administrador.\n'
printf '  2. Confira os modelos locais e crie suas knowledge bases.\n'
printf '  3. Na Admin UI, crie workspaces e adicione repositorios.\n'
printf '  4. Configure seus agentes MCP para usar o gateway.\n\n'
