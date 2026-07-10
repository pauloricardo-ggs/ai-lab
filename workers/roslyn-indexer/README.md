# roslyn-indexer

Responsavel por indexar projetos C# e VB.NET.

## Extrair

- solution
- project
- namespace
- class
- interface
- record
- struct
- enum
- method
- property
- constructor
- attribute
- inheritance
- implementation
- method calls
- references

## Gravar

- PostgreSQL: `code_symbols`
- Neo4j: nos e relacionamentos
- Qdrant: apenas via `embedding-worker`

## Relacionamentos Neo4j

- `CONTAINS`
- `DECLARES`
- `CALLS`
- `REFERENCES`
- `IMPLEMENTS`
- `INHERITS`
- `USES`

