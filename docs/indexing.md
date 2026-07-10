# Indexacao

## Documentos

1. `document-ingestion` extrai texto.
2. O conteudo e normalizado e quebrado em chunks.
3. `documents` e `document_chunks` recebem os metadados.
4. `embedding-worker` gera vetores.
5. Qdrant recebe pontos em `business_documents`.

## Codigo

1. `repository-sync` clona ou atualiza repositorios.
2. `roslyn-indexer` indexa C#.
3. `tree-sitter-indexer` suporta linguagens futuras.
4. `graph-builder` consolida relacoes no Neo4j.
5. `embedding-worker` grava vetores em `code_symbols`.

## Codigo - Versao Atual

Na versao atual, a Admin UI dispara uma indexacao real em background logo apos o clone. O repositorio e a unidade de ingestao, mas o escopo do indice e do grafo e o workspace:

1. escaneia arquivos suportados no repositorio
2. cria chunks por linhas
3. extrai simbolos por linguagem
4. gera embeddings locais via Ollama
5. grava chunks em `code_chunks`
6. grava simbolos em `code_symbols`
7. grava relacoes em `code_relationships`
8. envia vetores para Qdrant
9. cria grafo no Neo4j com `Workspace`, `Repository`, `CodeFile`, `CodeSymbol` e `CodeReference`
10. cria relacoes cross-repo simples entre simbolos de mesmo nome dentro do workspace

Indexadores especificos:

- C#: Roslyn Indexer (`roslyn-indexer`) para namespaces, tipos, metodos, propriedades, using, heranca/referencias e chamadas. Se o servico estiver indisponivel, o Admin usa fallback local.
- TypeScript/JavaScript: imports, exports, require, classes, interfaces, types, enums, funcoes/metodos e chamadas.
- HTML/CSS: ids/classes/seletores e referencias a assets/links/imports.
- Swift: imports, tipos, protocolos, funcoes, conformances e chamadas.
- Dart: imports/exports/parts, tipos, mixins, extensions, funcoes, referencias e chamadas.
- JSON/YAML: chaves estruturais e dependencias conhecidas, como `package.json` e `pubspec.yaml`.
- SQL: tabelas, views, procedures/functions/triggers e referencias via `FROM`, `JOIN`, `REFERENCES`, `UPDATE`, `INSERT`.

Outras linguagens textuais entram pelo indexador generico, que extrai chaves e headings quando possivel.

O status do repositorio muda para `indexed` quando a indexacao termina. Se falhar, o status fica `index_error` e o repositorio pode ser reindexado pela Admin UI.

Cada execucao grava um job em `code_index_jobs` com `scope = workspace`, fase atual, repositorio atual, arquivo atual, total de arquivos do repositorio, arquivos indexaveis, arquivos ignorados, total de chunks, chunks processados, simbolos e erro. A Admin UI consulta esses jobs para exibir progresso em tempo real na tela de detalhe do workspace, separando jobs em execucao do historico finalizado paginado.

Um repositorio nao pode ter duas indexacoes ativas ao mesmo tempo. Se ja houver job `pending`, `running` ou `canceling`, a tentativa de reindexacao retorna `repository_index_already_running`. Jobs ativos podem ser cancelados pela Admin UI; o job passa por `canceling` e termina como `canceled`.

## Embeddings Locais

O `embedding-worker` deve usar o provider local configurado em `.env`.

Padrao:

```dotenv
LLM_PROVIDER=ollama
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_VECTOR_SIZE=768
```

Nao exigir chave de provedor externo para indexacao.
