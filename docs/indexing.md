# Indexacao

## Documentos

1. `document-ingestion` extrai texto.
2. O conteudo e normalizado e quebrado em chunks.
3. `documents` e `document_chunks` recebem os metadados.
4. `embedding-worker` gera vetores.
5. Qdrant recebe pontos em `business_documents`.

## Codigo

1. `repository-sync` clona ou atualiza repositorios.
2. `roslyn-indexer` indexa C# e VB.NET.
3. `tree-sitter-indexer` suporta linguagens futuras.
4. `graph-builder` consolida relacoes no Neo4j.
5. `embedding-worker` grava vetores em `code_symbols`.

## Embeddings Locais

O `embedding-worker` deve usar o provider local configurado em `.env`.

Padrao:

```dotenv
LLM_PROVIDER=ollama
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_VECTOR_SIZE=768
```

Nao exigir chave de provedor externo para indexacao.
