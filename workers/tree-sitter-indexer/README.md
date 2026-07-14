# tree-sitter-indexer

Responsavel pelo suporte futuro a multiplas linguagens seguindo o mesmo contrato do Roslyn Indexer.

## Linguagens Futuras

- TypeScript
- JavaScript
- Python
- Java
- Go
- Rust

## Regras

- emitir simbolos no mesmo formato de `code_symbols`
- devolver simbolos e chunks para a Admin UI, que gera os embeddings tecnicos
- preservar `workspace_id`, `repository_id`, `branch` e `commit_sha`
