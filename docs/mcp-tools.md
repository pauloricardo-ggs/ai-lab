# MCP Tools

## Gateway

O Gateway expõe somente o endpoint MCP Streamable HTTP `POST/GET /mcp`. Ele implementa JSON-RPC MCP (`initialize`, `tools/list` e `tools/call`) e roteia internamente para os serviços de código, conhecimento e Git.

Para registrar em um agente, use a URL `http://<IP_DO_SERVIDOR>:7000/mcp` e o header `Authorization: Bearer <GATEWAY_API_KEY>`. Todas as tools exigem `workspace_id` ou `workspace_slug` nos argumentos.

## Code MCP

- `code_search_symbol`
- `code_get_class`
- `code_get_method`
- `code_find_references`
- `code_find_callers`
- `code_find_callees`
- `code_find_dependencies`
- `code_search_code`
- `code_semantic_search_code`

Na versao atual, `code_search_code`, `code_semantic_search_code`, `code_search_symbol`, `code_get_class`, `code_get_method`, `code_find_references`, `code_find_callers`, `code_find_callees` e `code_find_dependencies` consultam os dados reais gerados pela indexacao de repositorios. Esses são nomes MCP públicos; o Gateway os converte para os nomes internos dos serviços.

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

## Tools ainda não expostas

As rotas internas de Knowledge e Git, assim como `code_explain_architecture` e `code_find_related_documents`, ainda não retornam dados reais. Por isso não são anunciadas pelo Gateway MCP até que suas implementações estejam concluídas; isso evita que agentes recebam respostas vazias ou especulativas.
