# MCP Tools

## Gateway

O Gateway expõe somente o endpoint MCP Streamable HTTP `POST/GET /mcp`. Ele implementa JSON-RPC MCP (`initialize`, `tools/list` e `tools/call`) e roteia internamente para os serviços de código, conhecimento e Git.

Para registrar em um agente, use a URL `http://<IP_DO_SERVIDOR>:7000/mcp` e o header `Authorization: Bearer <GATEWAY_API_KEY>`. Todas as tools exigem `workspace_id` ou `workspace_slug` nos argumentos.

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

Na versao atual, `code.search_code`, `code.semantic_search_code`, `code.search_symbol`, `code.get_class`, `code.get_method`, `code.find_references`, `code.find_callers`, `code.find_callees` e `code.find_dependencies` consultam os dados reais gerados pela indexacao de repositorios.

As tools de relacao retornam tambem os campos de resolucao quando disponiveis:

- `resolution_status`: `resolved_symbol`, `resolved_file`, `resolved_repository` ou `unresolved`
- `source_symbol_id`
- `target_symbol_id`
- `target_repository_id`
- `target_repository_name`
- `target_symbol_name`
- `target_symbol_full_name`
- `target_symbol_file_path`
- `target_symbol_start_line`

## Git MCP

- `git.get_history`
- `git.get_diff`
- `git.get_commit`
- `git.get_branch`
- `git.get_pull_request`
- `git.list_changed_files`
- `git.find_commits_touching_symbol`
- `git.search_commit_message`
