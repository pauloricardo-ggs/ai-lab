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

Na versao atual, `code_search_code`, `code_semantic_search_code`, `code_search_symbol`, `code_get_class`, `code_get_method`, `code_find_references`, `code_find_callers`, `code_find_callees`, `code_find_dependencies`, `code_explain_architecture` e `code_analyze_impact` consultam os dados reais gerados pela indexacao de repositorios. A explicacao agrega repositorios, linguagens, simbolos centrais, dependencias cross-repo e relacoes gRPC; o impacto percorre chamadores diretos e indiretos com repositorio, arquivo e linha.

As tools `git_get_commit`, `git_get_history`, `git_get_diff`, `git_get_branch`, `git_list_changed_files`, `git_find_commits_touching_symbol` e `git_search_commit_message` executam Git diretamente no clone local registrado para o repositorio. Informe `repository_id` (ou `repository`) quando o workspace possuir mais de um repositorio. O caminho vindo do banco e validado contra `REPOS_ROOT` antes da execucao.

Imports Protobuf podem cruzar repositorios quando o repositorio consumidor configura `metadata.proto_include_paths` (ou `protobuf_include_paths`) com nomes/IDs dos repositorios provedores, por exemplo `["contracts"]` ou `[{"repository":"contracts","include_path":"proto"}]`. A resolucao registra estrategia e confianca; clientes/provedores gRPC inferidos por convencao tambem recebem `domain=grpc`, `grpc_role` e confianca explicita.

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
