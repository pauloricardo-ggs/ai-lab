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
- gerar eventos para `embedding-worker`
- preservar `workspace_id`, `repository_id`, `branch` e `commit_sha`

