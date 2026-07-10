# graph-builder

Responsavel por consolidar relacoes extraidas e manter o grafo tecnico no Neo4j.

## Responsabilidades

- consolidar relacoes extraidas
- limpar relacoes antigas
- criar ou atualizar nos no Neo4j
- criar indices no Neo4j
- manter grafo consistente por workspace

## Isolamento Obrigatorio

- `workspace_id`
- `repository_id`
- `branch`
- `commit_sha`

