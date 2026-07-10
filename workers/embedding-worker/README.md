# embedding-worker

Responsavel por gerar embeddings de documentos e codigo.

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

