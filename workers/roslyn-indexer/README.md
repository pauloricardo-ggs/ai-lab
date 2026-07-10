# roslyn-indexer

Servico HTTP interno responsavel por analisar arquivos C# com Roslyn.

## Endpoint

```http
GET /health
POST /analyze
```

Payload:

```json
{
  "file_path": "src/Foo.cs",
  "language": "csharp",
  "content": "..."
}
```

Resposta:

```json
{
  "symbols": [],
  "relationships": []
}
```

## Extrai

- namespace
- class
- interface
- record
- struct
- enum
- method
- property
- constructor
- using/imports
- inheritance/interfaces como `REFERENCES`
- method calls como `CALLS`

O Admin UI consome esse servico durante a indexacao de arquivos `.cs`. Se o servico estiver indisponivel, o Admin usa fallback local baseado em padroes.

## Relacionamentos Neo4j

- `CONTAINS`
- `DECLARES`
- `CALLS`
- `REFERENCES`
- `IMPORTS`
- `DEPENDS_ON`
