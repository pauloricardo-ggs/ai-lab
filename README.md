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
DOTNET_SDK_IMAGE=mcr.microsoft.com/dotnet/sdk:X.Y
DOTNET_ASPNET_IMAGE=mcr.microsoft.com/dotnet/aspnet:X.Y
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
url = "http://<IP_DO_SERVIDOR>:7000/mcp"
headers = { "Authorization" = "Bearer <GATEWAY_API_KEY>" }
```

O Gateway exige `workspace_id` ou `workspace_slug` em chamadas de tools para impedir vazamento entre workspaces.

## Admin UI

A Admin UI e o portal operacional da plataforma. Ela oferece:

- dashboard de servicos disponiveis
- links para Open WebUI, Qdrant e Neo4j
- pagina operacional do MCP Gateway
- guia para registrar o MCP Gateway em agentes e no Open WebUI
- dashboard de containers e status de runtime
- criacao/listagem/remocao de workspaces
- criacao automatica da pasta `data/repos/<workspace_slug>`
- tela de detalhe por workspace com repositorios e indexacoes
- adicao de repositorios GitHub com clone automatico
- indexacao automatica de codigo por workspace apos o clone
- acompanhamento em tempo real do progresso de indexacao do workspace e historico paginado
- bloqueio de reindexacao concorrente no mesmo repositorio e cancelamento de jobs ativos
- relatorio de qualidade por repositorio com arquivos indexados, ignorados, erros, simbolos e relacoes
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

## Indexacao de Repositorios

Ao adicionar um repositorio pela Admin UI, a plataforma inicia a indexacao em background:

1. clona o repositorio em `data/repos/<workspace_slug>/<repository>`
2. escaneia arquivos de codigo/texto suportados, incluindo Swift/Xcode
3. extrai simbolos e relacoes por linguagem
4. divide o conteudo em chunks estruturais por simbolo quando possivel
5. gera embeddings locais com Ollama usando `EMBEDDING_MODEL`
6. grava chunks em `code_chunks`
7. grava simbolos em `code_symbols`, incluindo hierarquia quando conhecida
8. grava relacoes tecnicas em `code_relationships`
9. resolve relacoes para arquivos, simbolos ou repositorios reais do workspace
10. salva vetores no Qdrant na collection `code_symbols`
11. cria nos e relacionamentos no Neo4j sob o no `Workspace`
12. marca o repositorio como `indexed` ao concluir

O repositorio e a unidade de ingestao, mas o escopo do indice e do grafo e sempre o workspace. Isso permite consultar e relacionar repositorios diferentes dentro do mesmo workspace. O grafo usa `Workspace -> Repository -> CodeFile -> CodeSymbol`, cria hierarquia local com `CONTAINS_SYMBOL`, relaciona referencias resolvidas com `RESOLVES_TO` e cria `RELATED_SYMBOL` entre simbolos de mesmo nome em repositorios diferentes do workspace.

Linguagens com indexacao especifica:

- C# via Roslyn Indexer, com fallback local se o servico estiver indisponivel
- TypeScript e JavaScript
- HTML e CSS
- Swift
- Dart
- JSON
- YAML
- SQL
- Protobuf (`.proto`)

Outros arquivos textuais continuam sendo indexados pelo indexador generico. Manifestos como `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `pubspec.yaml`, `.csproj`, `Directory.Packages.props`, `packages.config`, `Package.swift` e `Podfile` geram relacoes `DEPENDS_ON`.

A reindexacao e incremental. A plataforma mantem inventario em `code_index_files`, compara hash por arquivo, reprocessa apenas arquivos novos/alterados, remove arquivos deletados do indice, preserva arquivos inalterados e re-resolve relacoes do workspace. O relatorio de qualidade do repositorio usa esse inventario para mostrar arquivos por linguagem, ignorados por motivo, erros por arquivo, simbolos por linguagem/tipo, relacoes por tipo e status de resolucao.

Enquanto a indexacao esta rodando, o status fica `indexing`. A Admin UI mostra o job do workspace em tempo real, incluindo fase atual, arquivo em processamento, total de arquivos do repositorio, arquivos indexaveis, arquivos ignorados, chunks processados e erros. Se houver falha, fica `index_error` e o repositorio pode ser reindexado pelo botao `Reindexar` na Admin UI.

A plataforma nao permite iniciar outra reindexacao para um repositorio que ja tenha job ativo. Jobs em execucao podem ser cancelados na tela do workspace; ao cancelar, o job fica `canceled` e o repositorio fica `index_canceled`.

As tools `code.search_code`, `code.semantic_search_code`, `code.search_symbol`, `code.get_class`, `code.get_method`, `code.find_references`, `code.find_callers`, `code.find_callees` e `code.find_dependencies` ja consultam os dados indexados por workspace. As tools de relacao retornam tambem o alvo resolvido quando houver simbolo, arquivo ou repositorio correspondente.

## Roadmap

O roadmap de continuidade esta em `docs/roadmap.md`. Ele descreve o que ja foi implementado, lacunas conhecidas, proximas fases e criterios de aceite para outros agentes continuarem a implementacao.

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
