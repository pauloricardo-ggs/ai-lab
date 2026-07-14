# MCP Tools

## Escopo

O Gateway expoe somente codigo indexado e Git local no endpoint MCP Streamable HTTP `POST/GET /mcp`. Documentos e Knowledge Bases pertencem exclusivamente ao Open WebUI; nenhuma tool documental e anunciada pelo Gateway.

Use `http://<IP_DO_SERVIDOR>:7000/mcp` com `Authorization: Bearer <GATEWAY_API_KEY>`. Toda chamada exige `workspace_id` ou `workspace_slug`. Um endpoint pode ser fixado com `?workspace_slug=<slug>`; nesse caso o Gateway sobrescreve qualquer escopo enviado pelo agente.

Opcionalmente, `GATEWAY_WORKSPACE_KEYS_JSON` associa tokens a workspaces, por exemplo `{"claps":"segredo-claps"}`. Um token assim nao pode consultar outro workspace. O `GATEWAY_API_KEY` global continua disponivel para operacao administrativa.

## Contratos

As 21 tools possuem schemas fechados (`additionalProperties=false`), campos obrigatorios especificos e annotations somente leitura. Argumentos desconhecidos retornam `invalid_arguments`; tools inexistentes retornam a lista de tools disponiveis.

### Code MCP

- `code_search_symbol`
- `code_get_class`
- `code_get_method`
- `code_find_references`
- `code_find_callers`
- `code_find_callees`
- `code_find_dependencies`
- `code_search_code`
- `code_semantic_search_code`
- `code_explain_architecture`
- `code_analyze_impact`
- `code_search_business_rules`
- `code_research_flow`
- `code_research_continue`

`code_search_code` faz busca lexical por termos e caminhos. `code_semantic_search_code` consulta Qdrant e usa fallback lexical quando embeddings ou busca vetorial falham.

`code_research_flow` e a primeira tool para fluxos, integracoes, eventos, status e regras de negocio. Ela recupera candidatos semanticamente e lexicalmente, consulta simbolos, relacoes e regras extraidas, combina os rankings com Reciprocal Rank Fusion e diversifica as evidencias por repositorio e arquivo. O retorno declara `documents_included=false`.

`code_research_continue` usa uma sessao persistida em `code_research_sessions`. O cursor sobrevive a restart e pode ser atendido por outra replica enquanto estiver dentro de `RESEARCH_SESSION_TTL_MS`.

`code_search_business_rules` consulta comportamentos inferidos deterministicamente durante a indexacao. Cada regra contem tipo, evidencia de codigo, arquivo/linhas, simbolo, commit indexado, confianca, justificativa, `evidence_status` e, quando aplicavel, a estrutura semantica de pre-condicoes, decisoes, efeitos e consequencias. O status e calculado automaticamente pela coerencia das evidencias; essas regras descrevem implementacao observada e nao substituem politicas documentais do Open WebUI.

### Git MCP

- `git_get_commit`
- `git_get_history`
- `git_get_diff`
- `git_get_branch`
- `git_list_changed_files`
- `git_find_commits_touching_symbol`
- `git_search_commit_message`

Todas executam Git somente no clone local registrado e validado dentro de `REPOS_ROOT`. Elas nao consultam a API do GitHub.
Em repositorios com apenas o commit raiz, `git_get_diff` e `git_list_changed_files` usam a arvore vazia quando `HEAD^` ainda nao existe.

Pull requests, issues, reviews e operacoes remotas devem usar um servidor MCP GitHub dedicado. Se o agente chamar `github_*` ou `git_get_pull_request` no Gateway, recebe `github_tool_not_available_on_code_gateway` com essa orientacao, em vez de um erro generico.

## Observabilidade e testes

Cada chamada gera `request_id`, tool, servico de destino, workspace, repositorio, status, latencia, quantidade de resultados e indicador de fallback nos logs estruturados. O mesmo `request_id` e encaminhado ao servico interno.

Execute os testes contratuais, de ranking, extracao de regras e protocolo E2E com:

```bash
./scripts/test-mcp.sh
```

Para validar a stack real e suas dependencias:

```bash
docker compose up -d --build
./scripts/check-health.sh
```

Com um workspace/repositório ja indexado, execute tambem o smoke de todas as tools:

```bash
MCP_WORKSPACE_SLUG=<slug> MCP_REPOSITORY_ID=<uuid> node tests/mcp-live-smoke.mjs
```
