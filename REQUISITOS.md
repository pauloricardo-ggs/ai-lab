Planejamento atualizado de implementação

# AI Knowledge Platform
## Objetivo
Criar uma plataforma interna para:
1. Upload e consulta de documentos corporativos via Open WebUI.
2. Indexação técnica de repositórios.
3. Exposição do conhecimento via MCP Gateway para agentes como Codex, Claude, Cursor e VS Code.
---
## Stack
- Ubuntu Server 26
- Docker
- Docker Compose
- Open WebUI
- Qdrant
- PostgreSQL
- Neo4j
- MCP Gateway
- Knowledge MCP
- Code MCP
- Git MCP
As imagens Docker devem sempre usar versão fixa, nunca `latest` ou `main`.
Referências importantes:
- Docker recomenda instalar Docker Engine e Docker Compose Plugin no Ubuntu.
- Neo4j pode ser executado via Docker Compose com volumes persistentes e autenticação.
- Open WebUI recomenda imagem `ghcr.io/open-webui/open-webui`, podendo usar versão fixa no lugar de `main`.
- Qdrant fornece imagem Docker oficial para execução local.
---
# Estrutura do projeto
```text
ai-knowledge-platform/
├── README.md
├── docker-compose.yml
├── .env.example
├── .gitignore
├── install.sh
├── init.sh
├── scripts/
│   ├── init-db.sql
│   ├── create-qdrant-collections.sh
│   ├── check-health.sh
│   └── backup.sh
│
├── apps/
│   ├── gateway/
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── src/
│   │
│   ├── knowledge-mcp/
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── src/
│   │
│   ├── code-mcp/
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── src/
│   │
│   └── git-mcp/
│       ├── Dockerfile
│       ├── package.json
│       └── src/
│
├── workers/
│   ├── repository-sync/
│   ├── document-ingestion/
│   ├── embedding-worker/
│   ├── roslyn-indexer/
│   ├── tree-sitter-indexer/
│   └── graph-builder/
│
├── data/
│   ├── postgres/
│   ├── qdrant/
│   ├── neo4j/
│   ├── open-webui/
│   └── repos/
│
└── docs/
    ├── architecture.md
    ├── mcp-tools.md
    ├── workspaces.md
    ├── indexing.md
    └── operations.md

⸻

Versões Docker fixadas

Não usar:

image: postgres:latest
image: qdrant/qdrant:latest
image: neo4j:latest
image: ghcr.io/open-webui/open-webui:main

Usar versões fixas.

Exemplo inicial:

POSTGRES_IMAGE=postgres:17.5-alpine
QDRANT_IMAGE=qdrant/qdrant:v1.17.1
NEO4J_IMAGE=neo4j:5.26.8
OPEN_WEBUI_IMAGE=ghcr.io/open-webui/open-webui:v0.6.15
NODE_IMAGE=node:22.17.0-alpine
DOTNET_IMAGE=mcr.microsoft.com/dotnet/sdk:9.0

O administrador deve revisar essas versões antes do primeiro deploy e antes de upgrades.

⸻

docker-compose.yml

services:
  postgres:
    image: ${POSTGRES_IMAGE}
    container_name: ai-postgres
    restart: unless-stopped
    env_file:
      - .env
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
      - ./scripts/init-db.sql:/docker-entrypoint-initdb.d/init-db.sql:ro
    ports:
      - "${POSTGRES_PORT}:5432"
    networks:
      - ai-platform
  qdrant:
    image: ${QDRANT_IMAGE}
    container_name: ai-qdrant
    restart: unless-stopped
    environment:
      QDRANT__SERVICE__API_KEY: ${QDRANT_API_KEY}
    volumes:
      - ./data/qdrant:/qdrant/storage
    ports:
      - "${QDRANT_HTTP_PORT}:6333"
      - "${QDRANT_GRPC_PORT}:6334"
    networks:
      - ai-platform
  neo4j:
    image: ${NEO4J_IMAGE}
    container_name: ai-neo4j
    restart: unless-stopped
    environment:
      NEO4J_AUTH: neo4j/${NEO4J_PASSWORD}
      NEO4J_PLUGINS: '["apoc"]'
    volumes:
      - ./data/neo4j/data:/data
      - ./data/neo4j/logs:/logs
      - ./data/neo4j/import:/var/lib/neo4j/import
      - ./data/neo4j/plugins:/plugins
    ports:
      - "${NEO4J_HTTP_PORT}:7474"
      - "${NEO4J_BOLT_PORT}:7687"
    networks:
      - ai-platform
  open-webui:
    image: ${OPEN_WEBUI_IMAGE}
    container_name: ai-open-webui
    restart: unless-stopped
    env_file:
      - .env
    environment:
      WEBUI_SECRET_KEY: ${OPEN_WEBUI_SECRET_KEY}
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      VECTOR_DB: qdrant
      QDRANT_URI: http://qdrant:6333
      QDRANT_API_KEY: ${QDRANT_API_KEY}
    volumes:
      - ./data/open-webui:/app/backend/data
    ports:
      - "${OPEN_WEBUI_PORT}:8080"
    depends_on:
      - postgres
      - qdrant
    networks:
      - ai-platform
  gateway:
    build:
      context: ./apps/gateway
      args:
        NODE_IMAGE: ${NODE_IMAGE}
    container_name: ai-mcp-gateway
    restart: unless-stopped
    env_file:
      - .env
    ports:
      - "${MCP_GATEWAY_PORT}:7000"
    depends_on:
      - knowledge-mcp
      - code-mcp
      - git-mcp
    networks:
      - ai-platform
  knowledge-mcp:
    build:
      context: ./apps/knowledge-mcp
      args:
        NODE_IMAGE: ${NODE_IMAGE}
    container_name: ai-knowledge-mcp
    restart: unless-stopped
    env_file:
      - .env
    depends_on:
      - postgres
      - qdrant
    networks:
      - ai-platform
  code-mcp:
    build:
      context: ./apps/code-mcp
      args:
        NODE_IMAGE: ${NODE_IMAGE}
    container_name: ai-code-mcp
    restart: unless-stopped
    env_file:
      - .env
    depends_on:
      - postgres
      - qdrant
      - neo4j
    networks:
      - ai-platform
  git-mcp:
    build:
      context: ./apps/git-mcp
      args:
        NODE_IMAGE: ${NODE_IMAGE}
    container_name: ai-git-mcp
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - ./data/repos:/repos
    depends_on:
      - postgres
    networks:
      - ai-platform
networks:
  ai-platform:
    driver: bridge

⸻

.env.example

# Images
POSTGRES_IMAGE=postgres:17.5-alpine
QDRANT_IMAGE=qdrant/qdrant:v1.17.1
NEO4J_IMAGE=neo4j:5.26.8
OPEN_WEBUI_IMAGE=ghcr.io/open-webui/open-webui:v0.6.15
NODE_IMAGE=node:22.17.0-alpine
# Ports
POSTGRES_PORT=5432
QDRANT_HTTP_PORT=6333
QDRANT_GRPC_PORT=6334
NEO4J_HTTP_PORT=7474
NEO4J_BOLT_PORT=7687
OPEN_WEBUI_PORT=3000
MCP_GATEWAY_PORT=7000
# PostgreSQL
POSTGRES_DB=ai_platform
POSTGRES_USER=ai_platform
POSTGRES_PASSWORD=
# Qdrant
QDRANT_API_KEY=
# Neo4j
NEO4J_PASSWORD=
# Open WebUI
OPEN_WEBUI_SECRET_KEY=
# MCP Gateway
GATEWAY_API_KEY=
# LLM / Embeddings
LLM_PROVIDER=openai
OPENAI_API_KEY=
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_VECTOR_SIZE=1536
# Git
GITHUB_APP_ID=
GITHUB_WEBHOOK_SECRET=
GITHUB_PRIVATE_KEY_PATH=

⸻

README.md

# AI Knowledge Platform
## Visão geral
Esta plataforma sobe uma stack interna composta por:
- Open WebUI
- PostgreSQL
- Qdrant
- Neo4j
- MCP Gateway
- Knowledge MCP
- Code MCP
- Git MCP
Ela permite que usuários de negócio façam upload e consulta de documentos pelo Open WebUI e que desenvolvedores consultem conhecimento técnico e documental por meio de agentes compatíveis com MCP.
---
## Requisitos
Servidor Linux com:
- Ubuntu Server 26
- usuário com sudo
- acesso à internet para baixar pacotes e imagens Docker
- Docker
- Docker Compose Plugin
O script `install.sh` pode instalar Docker automaticamente caso ele ainda não exista.
---
## Instalação rápida
Clone o repositório:
```bash
git clone <repository-url>
cd ai-knowledge-platform

Execute:

chmod +x install.sh
./install.sh

O script irá:

1. Verificar dependências.
2. Solicitar variáveis obrigatórias.
3. Gerar o arquivo .env.
4. Criar diretórios locais.
5. Instalar Docker, se necessário.
6. Subir os containers.
7. Criar collections iniciais no Qdrant.
8. Verificar saúde dos serviços.
9. Exibir as URLs internas de acesso.

⸻

O que o administrador precisa configurar manualmente depois

Após a instalação, o administrador deve:

1. Acessar o Open WebUI.
2. Criar o primeiro usuário administrador.
3. Configurar provedor de LLM.
4. Configurar modelo de embedding.
5. Criar os workspaces necessários.
6. Criar as bases de conhecimento.
7. Fazer upload dos documentos.
8. Cadastrar repositórios no painel administrativo futuro ou diretamente no banco/API.
9. Configurar credenciais de acesso ao GitHub.
10. Configurar os agentes MCP, como Codex ou Claude, apontando para o MCP Gateway.

⸻

URLs padrão

Considerando portas padrão:

Open WebUI:
http://<IP_DO_SERVIDOR>:3000
Qdrant Dashboard:
http://<IP_DO_SERVIDOR>:6333/dashboard
Neo4j Browser:
http://<IP_DO_SERVIDOR>:7474
MCP Gateway:
http://<IP_DO_SERVIDOR>:7000

⸻

Comandos úteis

Subir:

docker compose up -d

Parar:

docker compose down

Logs:

docker compose logs -f

Status:

docker compose ps

Health check:

./scripts/check-health.sh

Backup:

./scripts/backup.sh

⸻

Atualização

Para atualizar imagens, nunca usar latest.

Editar .env e trocar explicitamente:

QDRANT_IMAGE=qdrant/qdrant:vX.Y.Z
OPEN_WEBUI_IMAGE=ghcr.io/open-webui/open-webui:vX.Y.Z
POSTGRES_IMAGE=postgres:X.Y-alpine
NEO4J_IMAGE=neo4j:X.Y.Z

Depois executar:

docker compose pull
docker compose up -d

⸻

Segurança

Esta versão inicial é para rede interna.

Não há proxy reverso, SSL externo, firewall ou SSO configurados neste MVP.

Antes de expor fora da rede interna, configurar:

* HTTPS
* autenticação corporativa
* firewall
* OIDC/OAuth2
* controle de acesso por workspace
* auditoria completa

---
# install.sh
```bash
#!/usr/bin/env bash
set -e
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
echo "Este script irá preparar o servidor e subir a stack Docker."
echo ""
if [ -f ".env" ]; then
  echo "Arquivo .env já existe."
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
  ask_default "NODE_IMAGE" "Imagem Node" "node:22.17.0-alpine"
  ask_default "POSTGRES_PORT" "Porta PostgreSQL" "5432"
  ask_default "QDRANT_HTTP_PORT" "Porta HTTP Qdrant" "6333"
  ask_default "QDRANT_GRPC_PORT" "Porta gRPC Qdrant" "6334"
  ask_default "NEO4J_HTTP_PORT" "Porta HTTP Neo4j" "7474"
  ask_default "NEO4J_BOLT_PORT" "Porta Bolt Neo4j" "7687"
  ask_default "OPEN_WEBUI_PORT" "Porta Open WebUI" "3000"
  ask_default "MCP_GATEWAY_PORT" "Porta MCP Gateway" "7000"
  ask_default "POSTGRES_DB" "Nome do banco PostgreSQL" "ai_platform"
  ask_default "POSTGRES_USER" "Usuário PostgreSQL" "ai_platform"
  echo "POSTGRES_PASSWORD=$(generate_secret)" >> .env
  echo "QDRANT_API_KEY=$(generate_secret)" >> .env
  echo "NEO4J_PASSWORD=$(generate_secret)" >> .env
  echo "OPEN_WEBUI_SECRET_KEY=$(generate_secret)" >> .env
  echo "GATEWAY_API_KEY=$(generate_secret)" >> .env
  ask_default "LLM_PROVIDER" "Provider LLM" "openai"
  ask_required "OPENAI_API_KEY" "OpenAI API Key"
  ask_default "EMBEDDING_MODEL" "Modelo de embedding" "text-embedding-3-small"
  ask_default "EMBEDDING_VECTOR_SIZE" "Tamanho do vetor embedding" "1536"
  ask_default "GITHUB_APP_ID" "GitHub App ID, opcional" ""
  ask_default "GITHUB_WEBHOOK_SECRET" "GitHub Webhook Secret, opcional" ""
  ask_default "GITHUB_PRIVATE_KEY_PATH" "Caminho da chave privada GitHub App, opcional" ""
  chmod 600 .env
fi
echo ""
echo "Resumo da instalação:"
echo ""
cat .env | sed -E 's/(PASSWORD|KEY|SECRET)=.*/\1=********/g'
echo ""
read -r -p "Confirmar instalação e subir containers? [s/N]: " confirm
if [[ "$confirm" != "s" && "$confirm" != "S" ]]; then
  echo "Instalação cancelada."
  exit 0
fi
echo ""
echo "Criando diretórios..."
mkdir -p \
  data/postgres \
  data/qdrant \
  data/neo4j/data \
  data/neo4j/logs \
  data/neo4j/import \
  data/neo4j/plugins \
  data/open-webui \
  data/repos \
  backups
echo ""
echo "Verificando Docker..."
if ! require_command docker; then
  echo "Docker não encontrado. Instalando Docker..."
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
  echo "Docker instalado. Talvez seja necessário sair e entrar novamente na sessão para usar Docker sem sudo."
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose Plugin não encontrado."
  exit 1
fi
echo ""
echo "Buildando e subindo containers..."
docker compose up -d --build
echo ""
echo "Aguardando serviços iniciarem..."
sleep 15
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
echo "Instalação concluída"
echo "======================================"
echo ""
echo "Open WebUI:"
echo "http://$SERVER_IP:$(grep OPEN_WEBUI_PORT .env | cut -d '=' -f2)"
echo ""
echo "Qdrant Dashboard:"
echo "http://$SERVER_IP:$(grep QDRANT_HTTP_PORT .env | cut -d '=' -f2)/dashboard"
echo ""
echo "Neo4j Browser:"
echo "http://$SERVER_IP:$(grep NEO4J_HTTP_PORT .env | cut -d '=' -f2)"
echo ""
echo "MCP Gateway:"
echo "http://$SERVER_IP:$(grep MCP_GATEWAY_PORT .env | cut -d '=' -f2)"
echo ""
echo "Próximos passos manuais:"
echo ""
echo "1. Acessar o Open WebUI."
echo "2. Criar o primeiro usuário administrador."
echo "3. Configurar provider de LLM."
echo "4. Configurar embeddings."
echo "5. Criar os workspaces."
echo "6. Criar as knowledge bases."
echo "7. Fazer upload dos documentos."
echo "8. Cadastrar repositórios."
echo "9. Configurar agentes MCP apontando para o gateway."
echo ""

⸻

init.sh

O init.sh pode ser apenas um alias operacional para o install.sh.

#!/usr/bin/env bash
set -e
chmod +x install.sh
./install.sh

⸻

scripts/init-db.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS workspace_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, user_email)
);
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    external_id TEXT,
    file_path TEXT,
    content_hash TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS document_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    qdrant_collection TEXT,
    qdrant_point_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS repositories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'github',
    url TEXT NOT NULL,
    default_branch TEXT NOT NULL DEFAULT 'main',
    local_path TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, name)
);
CREATE TABLE IF NOT EXISTS repository_sync_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    error TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS code_symbols (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    symbol_type TEXT NOT NULL,
    name TEXT NOT NULL,
    full_name TEXT NOT NULL,
    language TEXT NOT NULL,
    file_path TEXT NOT NULL,
    start_line INTEGER,
    end_line INTEGER,
    qdrant_collection TEXT,
    qdrant_point_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS mcp_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    actor TEXT,
    server_name TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    request_metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_documents_workspace_id ON documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_workspace_id ON document_chunks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_repositories_workspace_id ON repositories(workspace_id);
CREATE INDEX IF NOT EXISTS idx_code_symbols_workspace_id ON code_symbols(workspace_id);
CREATE INDEX IF NOT EXISTS idx_code_symbols_name ON code_symbols(name);
CREATE INDEX IF NOT EXISTS idx_code_symbols_full_name ON code_symbols(full_name);

⸻

scripts/create-qdrant-collections.sh

#!/usr/bin/env bash
set -e
source .env
QDRANT_URL="http://localhost:${QDRANT_HTTP_PORT}"
create_collection() {
  local collection_name="$1"
  echo "Criando collection $collection_name..."
  curl -s -X PUT "$QDRANT_URL/collections/$collection_name" \
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
create_collection "business_documents"
create_collection "code_symbols"
echo "Collections criadas."

⸻

scripts/check-health.sh

#!/usr/bin/env bash
set -e
source .env
echo "Verificando containers..."
docker compose ps
echo ""
echo "Verificando Open WebUI..."
curl -fsS "http://localhost:${OPEN_WEBUI_PORT}" >/dev/null && echo "Open WebUI OK"
echo ""
echo "Verificando Qdrant..."
curl -fsS "http://localhost:${QDRANT_HTTP_PORT}/collections" \
  -H "api-key: ${QDRANT_API_KEY}" >/dev/null && echo "Qdrant OK"
echo ""
echo "Verificando Neo4j..."
curl -fsS "http://localhost:${NEO4J_HTTP_PORT}" >/dev/null && echo "Neo4j OK"
echo ""
echo "Verificando MCP Gateway..."
curl -fsS "http://localhost:${MCP_GATEWAY_PORT}/health" >/dev/null && echo "MCP Gateway OK"
echo ""
echo "Health check finalizado."

⸻

scripts/backup.sh

#!/usr/bin/env bash
set -e
source .env
BACKUP_DIR="./backups/$(date +%F_%H-%M-%S)"
mkdir -p "$BACKUP_DIR"
echo "Backup PostgreSQL..."
docker exec ai-postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "$BACKUP_DIR/postgres.sql"
echo "Backup Qdrant..."
tar -czf "$BACKUP_DIR/qdrant.tar.gz" ./data/qdrant
echo "Backup Neo4j..."
tar -czf "$BACKUP_DIR/neo4j.tar.gz" ./data/neo4j
echo "Backup Open WebUI..."
tar -czf "$BACKUP_DIR/open-webui.tar.gz" ./data/open-webui
echo "Backup concluído em $BACKUP_DIR"

⸻

Dockerfile base para serviços Node

Usar em:

* apps/gateway/Dockerfile
* apps/knowledge-mcp/Dockerfile
* apps/code-mcp/Dockerfile
* apps/git-mcp/Dockerfile

ARG NODE_IMAGE=node:22.17.0-alpine
FROM ${NODE_IMAGE}
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY src ./src
EXPOSE 7000
CMD ["npm", "start"]

Para serviços que usam Git:

ARG NODE_IMAGE=node:22.17.0-alpine
FROM ${NODE_IMAGE}
RUN apk add --no-cache git openssh
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY src ./src
CMD ["npm", "start"]

⸻

Responsabilidades dos serviços

MCP Gateway

Responsável por:

* receber chamadas dos agentes
* autenticar request
* identificar workspace
* rotear para MCP correto
* auditar chamadas
* aplicar rate limit
* padronizar erro
* padronizar resposta

Não deve conter regra de indexação.

Tools roteadas:

knowledge.search_documents
knowledge.list_documents
knowledge.get_document
knowledge.search_business_rules
code.search_symbol
code.get_class
code.get_method
code.find_references
code.find_dependencies
code.search_code
git.get_history
git.get_diff
git.get_commit
git.get_branch
git.list_changed_files

⸻

Knowledge MCP

Responsável por:

* consultar documentos
* consultar chunks
* buscar no Qdrant
* aplicar filtro por workspace
* aplicar filtro por permissão
* retornar fontes e trechos relevantes

Deve expor:

search_documents
get_document
list_documents
search_business_rules
search_embeddings

⸻

Code MCP

Responsável por:

* consultar símbolos de código
* consultar grafo no Neo4j
* consultar embeddings de código no Qdrant
* explicar dependências
* localizar impacto técnico

Deve expor:

search_symbol
get_class
get_method
find_references
find_callers
find_callees
find_dependencies
explain_architecture
find_related_documents
search_code
semantic_search_code

⸻

Git MCP

Responsável por:

* consultar histórico Git
* consultar branch
* consultar commits
* consultar diffs
* consultar arquivos alterados
* cruzar commits com símbolos

Deve expor:

get_commit
get_history
get_pull_request
get_diff
get_branch
list_changed_files
find_commits_touching_symbol
search_commit_message

⸻

Estrutura dos workers

workers/repository-sync

Responsável por:

* clonar repositórios cadastrados
* atualizar repositórios existentes
* respeitar branch configurada
* registrar status de sync
* criar jobs de indexação após pull

Entrada:

repository_id
workspace_id
url
branch
credentials

Saída:

repositório atualizado em ./data/repos/<workspace>/<repository>
repository_sync_jobs atualizado
evento para roslyn-indexer/tree-sitter-indexer

⸻

workers/document-ingestion

Responsável por:

* ler documentos enviados
* extrair texto
* normalizar conteúdo
* quebrar em chunks
* gravar documents
* gravar document_chunks
* enviar chunks para embedding-worker

Formatos esperados:

PDF
DOCX
XLSX
PPTX
TXT
Markdown
HTML

⸻

workers/embedding-worker

Responsável por:

* receber chunks de documentos
* receber trechos de código
* gerar embeddings
* salvar vetores no Qdrant
* atualizar qdrant_point_id no PostgreSQL

Collections:

business_documents
code_symbols

Payload obrigatório no Qdrant:

{
  "workspace_id": "...",
  "source_type": "document|code",
  "document_id": "...",
  "repository_id": "...",
  "symbol_id": "...",
  "title": "...",
  "file_path": "...",
  "language": "...",
  "chunk_index": 0
}

⸻

workers/roslyn-indexer

Responsável por indexar projetos C# e VB.NET.

Deve extrair:

solution
project
namespace
class
interface
record
struct
enum
method
property
constructor
attribute
inheritance
implementation
method calls
references

Deve gravar:

PostgreSQL:
code_symbols
Neo4j:
nós e relacionamentos
Qdrant:
apenas via embedding-worker

Relacionamentos esperados no Neo4j:

CONTAINS
DECLARES
CALLS
REFERENCES
IMPLEMENTS
INHERITS
USES

⸻

workers/tree-sitter-indexer

Responsável por suporte futuro a múltiplas linguagens.

Linguagens futuras:

TypeScript
JavaScript
Python
Java
Go
Rust

Deve seguir o mesmo contrato do Roslyn Indexer.

⸻

workers/graph-builder

Responsável por:

* consolidar relações extraídas
* limpar relações antigas
* criar ou atualizar nós no Neo4j
* criar índices no Neo4j
* manter grafo consistente por workspace

Deve garantir isolamento por:

workspace_id
repository_id
branch
commit_sha

⸻

Modelo de workspace

Nenhum workspace deve ser criado automaticamente.

O administrador criará workspaces pelo painel administrativo futuro, API ou operação manual.

Entidade:

Workspace
├── id
├── name
├── slug
├── description
├── members
├── documents
├── repositories
├── qdrant payload filter
└── graph scope

Regra principal:

Toda consulta deve obrigatoriamente receber workspace_id ou workspace_slug.
Nenhum MCP deve retornar dados fora do workspace solicitado.

⸻

Fluxo de instalação esperado

Administrador
    ↓
git clone
    ↓
cd ai-knowledge-platform
    ↓
./install.sh
    ↓
script solicita variáveis
    ↓
script mostra resumo
    ↓
administrador confirma
    ↓
script instala Docker se necessário
    ↓
script cria .env
    ↓
script sobe docker compose
    ↓
script cria collections Qdrant
    ↓
script valida serviços
    ↓
sistema fica disponível na rede interna

⸻

Fluxo manual após instalação

Administrador acessa Open WebUI
    ↓
cria primeiro usuário admin
    ↓
configura LLM
    ↓
configura embeddings
    ↓
cria workspaces
    ↓
cria knowledge bases
    ↓
faz upload dos documentos
    ↓
cadastra repositórios
    ↓
configura credenciais GitHub
    ↓
executa primeiro sync
    ↓
executa primeira indexação
    ↓
configura Codex/Claude/Cursor para MCP Gateway

⸻

Configuração MCP para agentes

Exemplo genérico:

[mcp_servers.company]
url = "http://<IP_DO_SERVIDOR>:7000"
headers = { "x-api-key" = "<GATEWAY_API_KEY>" }

⸻

Critérios de aceite do MVP

[ ] install.sh executa sem intervenção manual além das perguntas
[ ] .env é gerado corretamente
[ ] docker compose sobe todos os serviços
[ ] Open WebUI acessível via IP interno
[ ] Qdrant acessível via IP interno
[ ] Neo4j acessível via IP interno
[ ] MCP Gateway responde health check
[ ] Nenhum workspace default é criado
[ ] Collections Qdrant são criadas
[ ] README explica instalação
[ ] README explica configuração manual pós-instalação
[ ] Estrutura dos workers está criada
[ ] Serviços MCP possuem contratos definidos
[ ] Todas as imagens Docker estão com versão fixada