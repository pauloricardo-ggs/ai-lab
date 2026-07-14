# Requisitos da plataforma

Atualizado em 2026-07-13. Este documento descreve a arquitetura vigente; detalhes operacionais ficam em `README.md` e `docs/`.

## Objetivo

A plataforma deve:

1. oferecer chat e Knowledge Bases documentais pelo Open WebUI;
2. indexar repositorios de codigo em workspaces tecnicos isolados;
3. relacionar simbolos, arquivos, dependencias, integracoes e historico Git local;
4. expor o conhecimento tecnico a agentes pelo MCP Gateway;
5. usar modelos locais por padrao e imagens Docker versionadas.

## Fronteiras de responsabilidade

### Open WebUI

E a unica autoridade sobre documentos, uploads, permissoes, chunks, embeddings, citacoes e regras documentais. O Docling atua como extrator stateless configurado pelo Open WebUI.

Nao deve existir Knowledge MCP no runtime. O Gateway nao pode consultar nem espelhar documentos do Open WebUI. Tabelas documentais legadas de instalacoes anteriores nao fazem parte do fluxo ativo.

### MCP Gateway

Expoe somente Code MCP e Git MCP local via Streamable HTTP. Deve:

- implementar `initialize`, `tools/list` e `tools/call`;
- validar schemas fechados e campos obrigatorios;
- exigir workspace ou usar workspace fixado no endpoint/token;
- aceitar chave administrativa global e tokens opcionais vinculados a slug;
- gerar correlation ID e logs estruturados;
- retornar orientacao acionavel para tools GitHub enviadas ao servidor errado.

### GitHub remoto

Pull requests, issues, reviews e operacoes remotas pertencem a um MCP GitHub dedicado configurado diretamente no agente. As tools `git_*` do Gateway operam somente no clone local e nunca reutilizam implicitamente credenciais do MCP GitHub.

## Stack

- Open WebUI e Docling
- Ollama
- PostgreSQL
- Qdrant
- Neo4j
- Admin UI
- MCP Gateway
- Code MCP
- Git MCP
- Roslyn Indexer

## Isolamento

O workspace e a fronteira logica de todas as consultas tecnicas. PostgreSQL, payloads Qdrant e nos Neo4j devem carregar `workspace_id`. Caminhos Git devem permanecer dentro de `REPOS_ROOT`.

`GATEWAY_WORKSPACE_KEYS_JSON` pode vincular cada segredo a um `workspace_slug`. Um token vinculado nao pode trocar de workspace por argumento ou query string.

## Indexacao tecnica

A indexacao deve ser incremental e registrar o commit utilizado. Para cada arquivo alterado:

1. extrair chunks estruturais, simbolos e relacoes;
2. gerar embeddings locais e gravar `code_chunks`/Qdrant;
3. gravar `code_symbols` e `code_relationships`;
4. extrair candidatos a regras de negocio em `code_business_rules`;
5. preservar arquivo, linhas, simbolo, evidencia, commit, confianca e justificativa;
6. atribuir `evidence_status` automaticamente a partir da coerência das evidências, sem exigir confirmação manual dos desenvolvedores;
7. sincronizar o grafo e resolver relacoes no workspace.

Regras extraidas representam comportamento observado no codigo, nao intencao documental. O extrator nao deve processar Markdown ou formatos documentais como fonte de regras tecnicas.

## Pesquisa e ranking

`code_research_flow` deve combinar:

- recuperacao semantica;
- recuperacao lexical;
- simbolos;
- relacoes;
- regras extraidas.

Ranks semanticamente incompatíveis nao devem ser somados diretamente. A fusao usa Reciprocal Rank Fusion e diversificacao por repositorio/arquivo. O retorno deve declarar que documentos nao foram incluidos.

`code_research_continue` usa sessoes persistidas em PostgreSQL com TTL configuravel, de modo que cursores sobrevivam a restart e multiplas replicas.

## Tools publicadas

### Codigo

- `code_search_code`
- `code_semantic_search_code`
- `code_search_symbol`
- `code_get_class`
- `code_get_method`
- `code_find_references`
- `code_find_callers`
- `code_find_callees`
- `code_find_dependencies`
- `code_explain_architecture`
- `code_analyze_impact`
- `code_search_business_rules`
- `code_research_flow`
- `code_research_continue`

### Git local

- `git_get_commit`
- `git_get_history`
- `git_get_diff`
- `git_get_branch`
- `git_list_changed_files`
- `git_find_commits_touching_symbol`
- `git_search_commit_message`

Tools placeholder, documentais ou que retornam `501` nao podem ser anunciadas.

## Qualidade e testes

A entrega deve manter:

- testes de contratos das 21 tools;
- teste E2E do protocolo MCP com upstream simulado;
- smoke opcional das 21 tools contra uma stack e repositorio reais;
- testes do RRF e diversificacao;
- testes da extracao de regras e proveniencia;
- testes Roslyn por linguagem suportada;
- `docker compose config --quiet`, validacao de shell e `git diff --check`.

O proximo ciclo de qualidade deve criar um corpus de perguntas reais e medir Recall@k, MRR, latencia, fallback lexical e avaliacao humana das evidencias.

## Seguranca operacional

- Nao registrar secrets ou tokens.
- Nao aceitar comandos Git arbitrarios.
- Validar referencias e caminhos Git.
- Usar HTTPS/OIDC antes de exposicao externa.
- Manter backup e restore testados.
- Nunca usar imagens `latest` ou `main`.
