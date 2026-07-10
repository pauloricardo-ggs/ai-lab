# repository-sync

Responsavel por clonar e atualizar repositorios cadastrados. Na versao atual, a Admin UI ja consegue registrar repositorios e executar o clone inicial em `./data/repos/<workspace>/<repository>`.

## Entrada

```json
{
  "repository_id": "...",
  "workspace_id": "...",
  "url": "...",
  "branch": "main",
  "credentials": {}
}
```

## Saida

- repositorio atualizado em `./data/repos/<workspace>/<repository>`
- `repository_sync_jobs` atualizado
- evento de indexacao para `roslyn-indexer` ou `tree-sitter-indexer`

## Regras

- respeitar branch configurada
- nao criar workspace automaticamente
- manter isolamento por `workspace_id`
- registrar erro no job quando clone/pull falhar
