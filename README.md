# AI Knowledge Platform

## Visao Geral

Esta plataforma sobe uma stack interna composta por:

- Open WebUI
- Ollama
- PostgreSQL
- Qdrant
- Neo4j
- Admin UI
- MCP Gateway
- Knowledge MCP
- Code MCP
- Git MCP

Ela permite que usuarios de negocio façam upload e consulta de documentos pelo Open WebUI e que desenvolvedores consultem conhecimento tecnico e documental por meio de agentes compativeis com MCP.

## Requisitos

Servidor Linux com:

- Ubuntu Server 26
- usuario com `sudo`
- acesso a internet para baixar pacotes e imagens Docker
- Docker
- Docker Compose Plugin

O script `install.sh` pode instalar Docker automaticamente caso ele ainda nao exista.

## Instalacao Rapida

Clone o repositorio:

```bash
git clone <repository-url>
cd ai-knowledge-platform
```

Execute:

```bash
chmod +x install.sh
./install.sh
```

O script ira:

1. Verificar dependencias.
2. Solicitar variaveis obrigatorias.
3. Gerar o arquivo `.env`.
4. Criar diretorios locais.
5. Instalar Docker, se necessario.
6. Subir os containers.
7. Criar collections iniciais no Qdrant.
8. Verificar saude dos servicos.
9. Exibir as URLs internas de acesso.

## Configuracao Manual Pos-Instalacao

Apos a instalacao, o administrador deve:

1. Acessar o Open WebUI.
2. Criar o primeiro usuario administrador.
3. Conferir os modelos locais no Open WebUI.
4. Acessar a Admin UI.
5. Criar os workspaces corporativos.
6. Adicionar repositorios aos workspaces.
7. Criar as bases de conhecimento no Open WebUI.
8. Configurar credenciais de acesso ao GitHub quando necessario.
9. Configurar os agentes MCP, como Codex ou Claude, apontando para o MCP Gateway.

Nenhum workspace default e criado automaticamente.

## URLs Padrao

Considerando portas padrao:

- Open WebUI: `http://<IP_DO_SERVIDOR>:3000`
- Admin UI: `http://<IP_DO_SERVIDOR>:8080`
- Ollama: `http://<IP_DO_SERVIDOR>:11434`
- Qdrant Dashboard: `http://<IP_DO_SERVIDOR>:6333/dashboard`
- Neo4j Browser: `http://<IP_DO_SERVIDOR>:7474`
- MCP Gateway: `http://<IP_DO_SERVIDOR>:7000`

## Comandos Uteis

Subir:

```bash
docker compose up -d
```

Parar:

```bash
docker compose down
```

Logs:

```bash
docker compose logs -f
```

Status:

```bash
docker compose ps
```

Health check:

```bash
./scripts/check-health.sh
```

Backup:

```bash
./scripts/backup.sh
```

## Atualizacao

Para atualizar imagens, nunca use `latest` ou `main`.

Edite `.env` e troque explicitamente:

```dotenv
QDRANT_IMAGE=qdrant/qdrant:vX.Y.Z
OPEN_WEBUI_IMAGE=ghcr.io/open-webui/open-webui:vX.Y.Z
POSTGRES_IMAGE=postgres:X.Y-alpine
NEO4J_IMAGE=neo4j:X.Y.Z
```

Depois execute:

```bash
docker compose pull
docker compose up -d
```

## Configuracao MCP para Agentes

Exemplo generico:

```toml
[mcp_servers.company]
url = "http://<IP_DO_SERVIDOR>:7000"
headers = { "x-api-key" = "<GATEWAY_API_KEY>" }
```

O Gateway exige `workspace_id` ou `workspace_slug` em chamadas de tools para impedir vazamento entre workspaces.

## Admin UI

A Admin UI e o portal operacional da plataforma. Ela oferece:

- dashboard de servicos disponiveis
- links para Open WebUI, Qdrant e Neo4j
- pagina operacional do MCP Gateway
- testador de tools MCP
- dashboard de containers e status de runtime
- criacao/listagem/remocao de workspaces
- criacao automatica da pasta `data/repos/<workspace_slug>`
- listagem de repositorios por workspace
- adicao de repositorios GitHub com clone automatico
- remocao do registro e da pasta clonada do repositorio

Para listar repositorios GitHub pela interface, configure `GITHUB_TOKEN` no `.env`. Para restringir a uma organizacao/owner por padrao, configure `GITHUB_OWNER`.

A Admin UI monta `/var/run/docker.sock` em modo somente leitura para exibir os containers da plataforma no dashboard.

## GitHub Token

O `GITHUB_TOKEN` e opcional. Ele e necessario quando a Admin UI precisa listar repositorios privados ou clonar repositorios privados pelo fluxo "Adicionar repositorio".

Permissoes minimas recomendadas:

- repositorios publicos: nenhuma permissao especial; o clone HTTPS publico funciona sem token
- fine-grained personal access token para repositorios privados: `Contents: Read-only` nos repositorios que poderao ser listados/clonados
- classic personal access token para repositorios privados: `repo`
- organizacoes com SSO/SAML: autorizar o token na organizacao

Prefira fine-grained token quando possivel, restringindo:

- somente a organizacao necessaria
- somente os repositorios que a plataforma pode acessar
- permissao apenas de leitura de conteudo
- validade curta/rotacionavel

O token e usado para:

1. consultar a API do GitHub e listar repositorios disponiveis
2. clonar via HTTPS quando o repositorio for privado

Ele nao precisa de permissao de escrita, admin, secrets, workflows ou pull requests.

Na Admin UI, o campo `usuario/org` e opcional:

- vazio: lista todos os repositorios visiveis pelo token autenticado, incluindo privados autorizados
- preenchido com organizacao ou usuario: filtra a lista visivel pelo token para aquele owner

Se aparecer `github_owner_without_visible_repositories_for_token`, verifique se o owner foi digitado corretamente e se o token tem acesso aos repositorios daquela organizacao/usuario. Em organizacoes com SSO/SAML, o token precisa estar autorizado na organizacao.

## Modelos Locais

O servidor foi desenhado para usar modelos locais/open source. O runtime padrao e o Ollama, exposto internamente para o Open WebUI por `OLLAMA_BASE_URL=http://ollama:11434`.

O instalador nao exige `OPENAI_API_KEY`. As variaveis relevantes sao:

```dotenv
LLM_PROVIDER=ollama
LOCAL_CHAT_MODEL=qwen2.5:7b-instruct
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_VECTOR_SIZE=768
```

Durante a instalacao, o `install.sh` baixa automaticamente os modelos configurados:

```bash
docker exec -it ai-ollama ollama pull qwen2.5:7b-instruct
docker exec -it ai-ollama ollama pull nomic-embed-text
```

Para trocar modelos, edite `LOCAL_CHAT_MODEL` e `EMBEDDING_MODEL` no `.env` antes de executar o install, ou rode `docker exec -it ai-ollama ollama pull <modelo>` manualmente depois.

O Open WebUI responde aos usuarios usando os modelos locais configurados. Quando os MCPs responderem a agentes externos, eles tambem devem consultar apenas dados indexados localmente e modelos locais quando precisarem de inferencia no servidor.

## Seguranca

Esta versao inicial e para rede interna.

Na versao atual, ainda nao ha proxy reverso, SSL externo, firewall ou SSO configurados.

Antes de expor fora da rede interna, configure:

- HTTPS
- autenticacao corporativa
- firewall
- OIDC/OAuth2
- controle de acesso por workspace
- auditoria completa
