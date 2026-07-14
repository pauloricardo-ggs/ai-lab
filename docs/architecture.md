# Arquitetura

## Componentes

- Open WebUI: interface para upload e consulta de documentos.
- Ollama: runtime local para modelos open source.
- PostgreSQL: metadados, workspaces tecnicos, repositorios, chunks de codigo, simbolos, regras extraidas, sessoes de pesquisa e auditoria.
- Qdrant: vetores de documentos e simbolos de codigo.
- Neo4j: grafo tecnico de dependencias, hierarquia de simbolos e relacoes resolvidas entre arquivos, simbolos e repositorios.
- Admin UI: portal operacional para dashboard, workspaces, repositorios e console MCP.
- Roslyn Indexer: parser C# com suporte a `SemanticModel` para extracao de simbolos, ranges, hierarquia e relacoes tecnicas.
- MCP Gateway: autenticacao global ou vinculada a workspace, contratos MCP, roteamento, observabilidade e padronizacao de erros.
- Code MCP: busca lexical/semantica, regras extraidas, simbolos, referencias, dependencias, arquitetura e pesquisas persistidas.
- Git MCP: historico, branches, commits, diffs e arquivos alterados no clone local.
- MCP GitHub externo: quando configurado no agente, atende pull requests, issues, reviews e operacoes remotas; nao e roteado pelo Gateway.

## Regra de Workspace

Toda consulta deve receber `workspace_id` ou `workspace_slug`. Nenhum MCP deve retornar dados fora do workspace solicitado.

Repositorios sao unidades de ingestao, mas nao sao a fronteira do conhecimento. O indice vetorial, as tabelas tecnicas e o grafo carregam `workspace_id`, permitindo que repositorios do mesmo workspace sejam consultados e relacionados entre si.

## Admin UI e Open WebUI

A Admin UI e a fonte operacional para workspaces corporativos e repositorios tecnicos. Ao criar um workspace nela, a plataforma grava a tabela `workspaces` e cria `data/repos/<workspace_slug>`.

O Open WebUI continua sendo usado para chat, modelos e Knowledge Bases documentais. Ele e a unica autoridade documental e nao e tratado como dono do workspace tecnico da plataforma.

As Knowledge Bases documentais sao dominios independentes dos workspaces tecnicos.
O Open WebUI preserva sua associacao `knowledge_id -> file_id`, controla acesso e
grava seus proprios vetores no Qdrant. O Docling e um sidecar stateless de
extracao: nao conhece workspaces do Admin Panel, nao escolhe a base e nao grava
documentos nas tabelas da plataforma.

O Gateway nao anuncia Knowledge MCP nem tools documentais. Tabelas documentais legadas podem existir em instalacoes atualizadas, mas nao fazem parte do fluxo ativo e nao recebem dados do Open WebUI.

## Pesquisa tecnica

`code_research_flow` combina candidatos semanticos e lexicais com Reciprocal Rank Fusion, acrescenta simbolos, relacoes e regras deterministicas e limita repeticoes por arquivo/repositorio. A sessao e gravada em `code_research_sessions`, permitindo que `code_research_continue` sobreviva a reinicios e balanceamento entre replicas.

As regras de `code_business_rules` representam comportamento observado no codigo. Toda regra preserva arquivo, linhas, simbolo, commit, evidencia, justificativa de confianca, status automatico de evidencia e, quando possivel, a estrutura semantica de pre-condicoes, decisoes, efeitos e consequencias. Elas nao recebem autoridade documental.

## Politica de Modelos

O servidor deve executar modelos locais/open source. O runtime padrao e Ollama. O instalador nao deve exigir chave OpenAI ou qualquer provedor externo.

Agentes externos que acessam o MCP Gateway podem usar qualquer IA do lado do desenvolvedor, mas o servidor deve responder a partir de dados locais indexados e, quando precisar de inferencia, usar modelos locais.

## Imagens Docker

As imagens devem ser versionadas explicitamente em `.env`; nao use `latest` nem `main`.
