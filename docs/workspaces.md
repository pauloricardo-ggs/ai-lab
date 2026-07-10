# Workspaces

Workspaces corporativos sao gerenciados pela Admin UI da plataforma.

## Entidade

```text
Workspace
├── id
├── name
├── slug
├── description
├── members
├── documents
├── repositories
├── qdrant payload filter
└── graph scope
```

## Regra Principal

Toda consulta deve obrigatoriamente receber `workspace_id` ou `workspace_slug`.

Filtros esperados:

- PostgreSQL: `workspace_id`
- Qdrant payload: `workspace_id`
- Neo4j: `workspace_id`, `repository_id`, `branch`, `commit_sha`

A indexacao pode ser disparada por repositorio, mas o indice pertence ao workspace. Repositorios diferentes do mesmo workspace podem ser relacionados no grafo e consultados em conjunto pelas tools MCP.

## Criacao

Ao criar um workspace pela Admin UI:

1. a tabela `workspaces` recebe `name`, `slug` e `description`
2. a pasta `data/repos/<workspace_slug>` e criada
3. o workspace passa a aparecer no testador do MCP Gateway

O Open WebUI pode ter Knowledge Bases relacionadas, mas nao e a fonte principal dos workspaces tecnicos.
