# MCP Tools

## Gateway

O Gateway expoe `GET /health`, `GET /tools` e `POST /tools/:tool`.

Todas as chamadas de tool exigem:

- header `x-api-key` quando `GATEWAY_API_KEY` estiver configurado
- `workspace_id` ou `workspace_slug` no corpo JSON

## Knowledge MCP

- `knowledge.search_documents`
- `knowledge.list_documents`
- `knowledge.get_document`
- `knowledge.search_business_rules`
- `knowledge.search_embeddings`

## Code MCP

- `code.search_symbol`
- `code.get_class`
- `code.get_method`
- `code.find_references`
- `code.find_callers`
- `code.find_callees`
- `code.find_dependencies`
- `code.explain_architecture`
- `code.find_related_documents`
- `code.search_code`
- `code.semantic_search_code`

Na versao atual, `code.search_code`, `code.semantic_search_code`, `code.search_symbol`, `code.get_class`, `code.get_method` e `code.find_references` consultam os dados reais gerados pela indexacao de repositorios.

## Git MCP

- `git.get_history`
- `git.get_diff`
- `git.get_commit`
- `git.get_branch`
- `git.get_pull_request`
- `git.list_changed_files`
- `git.find_commits_touching_symbol`
- `git.search_commit_message`
