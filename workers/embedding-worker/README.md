# embedding-worker

Componente reservado para embeddings do pipeline tecnico da plataforma. Os
embeddings de Knowledge Bases e regras de negocio sao gerados pelo Open WebUI e
nao devem ser duplicados por este worker.

## Collections

- `business_documents`
- `code_symbols`

## Payload Obrigatorio no Qdrant

```json
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
```

## Regras

- atualizar `qdrant_point_id` no PostgreSQL apos gravar vetor
- usar `EMBEDDING_MODEL` e `EMBEDDING_VECTOR_SIZE` do ambiente
- filtrar qualquer consulta por workspace
