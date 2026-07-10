# Arquitetura

## Componentes

- Open WebUI: interface para upload e consulta de documentos.
- Ollama: runtime local para modelos open source.
- PostgreSQL: metadados, workspaces, documentos, chunks, repositorios, simbolos e auditoria MCP.
- Qdrant: vetores de documentos e simbolos de codigo.
- Neo4j: grafo tecnico de dependencias, hierarquia de simbolos e relacoes resolvidas entre arquivos, simbolos e repositorios.
- Admin UI: portal operacional para dashboard, workspaces, repositorios e console MCP.
- Roslyn Indexer: parser C# com suporte a `SemanticModel` para extracao de simbolos, ranges, hierarquia e relacoes tecnicas.
- MCP Gateway: autenticacao, roteamento, rate limit, auditoria e padronizacao de erros.
- Knowledge MCP: consultas documentais e semanticas.
- Code MCP: consultas de simbolos, referencias, dependencias e arquitetura.
- Git MCP: historico, branches, commits, diffs e arquivos alterados.

## Regra de Workspace

Toda consulta deve receber `workspace_id` ou `workspace_slug`. Nenhum MCP deve retornar dados fora do workspace solicitado.

Repositorios sao unidades de ingestao, mas nao sao a fronteira do conhecimento. O indice vetorial, as tabelas tecnicas e o grafo carregam `workspace_id`, permitindo que repositorios do mesmo workspace sejam consultados e relacionados entre si.

## Admin UI e Open WebUI

A Admin UI e a fonte operacional para workspaces corporativos e repositorios tecnicos. Ao criar um workspace nela, a plataforma grava a tabela `workspaces` e cria `data/repos/<workspace_slug>`.

O Open WebUI continua sendo usado para chat, modelos e Knowledge Bases documentais. Ele nao e tratado como dono do workspace tecnico da plataforma.

## Politica de Modelos

O servidor deve executar modelos locais/open source. O runtime padrao e Ollama. O instalador nao deve exigir chave OpenAI ou qualquer provedor externo.

Agentes externos que acessam o MCP Gateway podem usar qualquer IA do lado do desenvolvedor, mas o servidor deve responder a partir de dados locais indexados e, quando precisar de inferencia, usar modelos locais.

## Imagens Docker

As imagens devem ser versionadas explicitamente em `.env`; nao use `latest` nem `main`.
