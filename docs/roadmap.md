# Roadmap da Plataforma

Atualizado em: 2026-07-13

Este documento descreve o que ja foi implementado, o que ainda precisa ser implementado e a ordem recomendada para continuacao do desenvolvimento. Ele deve ser usado como handoff para agentes e desenvolvedores que forem assumir novas melhorias.

## Objetivo do Produto

Construir uma plataforma interna de IA, local-first, para:

1. Manter upload, indexacao e consulta de documentos corporativos no Open WebUI.
2. Indexar repositorios de codigo por workspace.
3. Relacionar codigo, regras observadas, dependencias e historico Git local.
4. Expor conhecimento tecnico via MCP Gateway para agentes externos como Codex, Claude, Cursor e VS Code.
5. Manter execucao do servidor com modelos locais/open source, sem exigir provedores externos para inferencia ou embeddings.

## Decisoes de Arquitetura Ja Tomadas

- A plataforma nao deve ser tratada como PoC; a implementacao deve evoluir incrementalmente para versao final.
- O workspace e o limite logico de isolamento e consulta.
- O repositorio e uma unidade de ingestao, mas o indice e o grafo sao de escopo do workspace.
- O Open WebUI pode ter seus proprios workspaces/bases de conhecimento, mas a plataforma mantem workspaces locais em PostgreSQL.
- O servidor deve usar modelos locais por padrao via Ollama.
- O MCP Gateway sempre exige `workspace_id` ou `workspace_slug`.
- Repositorios sao gerenciados pela Admin UI e clonados em `data/repos/<workspace_slug>/<repo>`.
- Open WebUI atende usuarios de negocio; MCP atende agentes tecnicos externos.
- Open WebUI e a unica autoridade documental; o MCP nao expoe Knowledge nem documentos.
- GitHub remoto e responsabilidade de um MCP GitHub dedicado; o Gateway tecnico opera clones locais.
- Qdrant armazena vetores.
- Neo4j armazena grafo tecnico.
- PostgreSQL armazena metadados, inventario, chunks, simbolos, relacoes, jobs e workspaces.
- Imagens Docker devem usar versoes fixas, nunca `latest` ou `main`.

## Estado Atual Implementado

### Atualizacoes recentes (2026-07-12)

- Instalador interativo revisado com etapas visuais, preflight, resumo de configuracao e mensagens de erro mais claras.
- Timeouts da indexacao ajustados para modelos locais e repositorios maiores:
  - arquivo completo: 20 minutos;
  - embedding: 5 minutos;
  - Roslyn e Neo4j: 2 minutos.
- O seletor de concorrencia da fila permanece aberto durante o polling de estatisticas da Admin UI.
- A resolucao de relacoes continua sendo executada no escopo de todo o workspace ao final de cada job. Assim, repositorios indexados em paralelo tambem podem ser relacionados quando ambos concluem.

### Infraestrutura

- Docker Compose com servicos principais:
  - PostgreSQL
  - Qdrant
  - Neo4j
  - Ollama
  - Open WebUI
  - Admin UI
  - MCP Gateway
  - Code MCP
  - Git MCP
  - Roslyn Indexer
- `.env.example` com configuracao local-first.
- `install.sh` instala Docker quando necessario, prepara `.env`, sobe containers e baixa modelos Ollama configurados.
- Script de health check em `scripts/check-health.sh`.
- Script de backup em `scripts/backup.sh`.
- Script de criacao de collections Qdrant em `scripts/create-qdrant-collections.sh`.
- Volumes persistentes em `data/`.

### Banco de Dados

Tabelas principais implementadas:

- `workspaces`
- `repositories`
- `code_chunks`
- `code_symbols`
- `code_relationships`
- `code_business_rules`
- `code_research_sessions`
- `code_index_files`
- `code_index_jobs`
- `mcp_audit_logs`

Capacidades de schema ja incluidas:

- Inventario incremental por arquivo em `code_index_files`.
- Jobs de indexacao em `code_index_jobs`.
- Simbolos com hierarquia em `code_symbols.parent_name` e `code_symbols.parent_full_name`.
- Relacoes resolvidas em `code_relationships` com:
  - `source_symbol_id`
  - `target_symbol_id`
  - `target_repository_id`
  - `target_file_path`
  - `resolution_status`
  - `resolution_metadata`

### Admin UI

Implementado:

- Dashboard inicial com cards de servicos.
- Links operacionais para Admin Panel, Open WebUI, Qdrant, Neo4j e pagina do MCP Gateway.
- Testador de tools MCP.
- Gerenciamento de workspaces:
  - listar
  - criar
  - editar
  - remover
- Tela de detalhe do workspace.
- Gerenciamento de repositorios por workspace:
  - listar repositorios
  - listar repositorios GitHub disponiveis via token
  - adicionar repositorio
  - clonar automaticamente
  - remover repositorio e seus indices
  - reindexar repositorio
- Indexacoes:
  - progresso em tempo real
  - card separado para jobs em execucao
  - historico finalizado paginado
  - bloqueio de reindexacao concorrente no mesmo repositorio
  - cancelamento de job ativo
- Relatorio de qualidade por repositorio:
  - total de arquivos inventariados
  - indexados, ignorados e erros
  - arquivos por linguagem
  - simbolos por linguagem
  - simbolos por tipo
  - relacoes por tipo
  - relacoes por status de resolucao
  - relacoes resolvidas/nao resolvidas por linguagem
  - ate 100 arquivos ignorados ou com erro
- Dashboard de containers/status operacional.

### GitHub e Repositorios

Implementado:

- Uso de GitHub Personal Access Token.
- Remocao da necessidade de GitHub App.
- Listagem de repositorios por owner.
- Clone automatico com token quando URL for GitHub HTTPS.
- Associacao de repositorio ao workspace local.
- Delecao de repositorio remove diretorio local e registros relacionados.

Pendencias conhecidas:

- Botao/fluxo de atualizar repositorio existente via `git fetch`/`pull`.
- Registro de commit atual indexado.
- Suporte melhor a branch switching.
- Historico real no Git MCP ainda e limitado.

### Indexacao de Codigo

Implementado:

- Indexacao automatica apos clone.
- Reindexacao manual pela Admin UI.
- Indexacao incremental por hash de arquivo.
- Remocao de arquivos deletados do PostgreSQL, Qdrant e Neo4j.
- Arquivos inalterados sao preservados.
- Arquivos ignorados e erros por arquivo sao registrados.
- Cancelamento limpa o arquivo ativo e marca job como `canceled`.
- Status de repositorio:
  - `cloning`
  - `active`
  - `indexing`
  - `indexed`
  - `indexed_with_errors`
  - `index_error`
  - `index_canceled`

Linguagens com indexacao especifica:

- C# via Roslyn Indexer, com fallback local.
- TypeScript.
- JavaScript.
- HTML.
- CSS.
- Swift.
- Dart.
- JSON.
- YAML.
- SQL.
- Protobuf (`.proto`).

Outras linguagens textuais:

- Entram pelo indexador generico.
- Extraem headings/chaves quando possivel.

Manifestos de dependencias ja tratados:

- `package.json`
- `package-lock.json`
- `pnpm-lock.yaml`
- `yarn.lock`
- `pubspec.yaml`
- `pubspec.lock`
- `.csproj`
- `Directory.Packages.props`
- `packages.config`
- `Package.swift`
- `Podfile`

### Chunks, Simbolos e Relacoes

Implementado:

- Chunks estruturais por simbolo quando possivel.
- Fallback por janelas de linhas.
- Chunks incluem metadados de simbolo:
  - `symbol_name`
  - `symbol_full_name`
  - `symbol_type`
  - `parent_name`
  - `parent_full_name`
- Simbolos incluem range e hierarquia.
- Relacoes extraidas:
  - `IMPORTS`
  - `CALLS`
  - `REFERENCES`
  - `DEPENDS_ON`
- Resolucao de relacoes por camadas:
  - import relativo para arquivo indexado
  - simbolo no mesmo repositorio
  - simbolo em outro repositorio do mesmo workspace
  - dependencia para repositorio do workspace por nome/URL
- Protobuf extrai imports, packages, messages, services, RPCs, tipos de request/response e referencias de campos. Tipos e RPCs podem ser resolvidos contra simbolos de outros repositorios do workspace.

Limitacao atual de Protobuf:

- Um `import "caminho/contrato.proto"` e resolvido por caminho apenas dentro do mesmo repositorio. Imports por include path entre repositorios ainda nao sao ligados diretamente.
- A plataforma reconhece o contrato gRPC e seus tipos, mas ainda nao comprova uma chamada de rede entre dois servicos a partir de clientes gerados ou configuracoes de endpoint.

### Roslyn Indexer

Implementado:

- Servico .NET para analise C#.
- Extracao de:
  - namespaces
  - classes
  - interfaces
  - records
  - structs
  - enums
  - metodos
  - construtores
  - propriedades
  - usings
  - heranca/base types
  - chamadas
  - object creation
- Uso de `SemanticModel` quando possivel para:
  - nomes qualificados
  - ranges
  - hierarquia
  - alvos semanticos
- Fallback local no Admin caso o servico esteja indisponivel.

### Qdrant

Implementado:

- Collection de codigo `code_symbols`.
- Points por chunk de codigo.
- Payload com:
  - workspace
  - repositorio
  - caminho do arquivo
  - linguagem
  - indice do chunk
  - linhas inicial/final
- Busca semantica em `code.search_code` e `code.semantic_search_code`.
- Fallback textual no Code MCP se a busca vetorial falhar.

### Neo4j

Implementado:

- Nos:
  - `Workspace`
  - `Repository`
  - `CodeFile`
  - `CodeSymbol`
  - `CodeReference`
- Relacionamentos:
  - `CONTAINS`
  - `DECLARES`
  - `IMPORTS`
  - `CALLS`
  - `REFERENCES`
  - `DEPENDS_ON`
  - `CONTAINS_SYMBOL`
  - `EMITS_REFERENCE`
  - `RESOLVES_TO`
  - `RELATED_SYMBOL`
- Limpeza por repositorio e por arquivo.
- Sincronizacao de relacoes resolvidas apos indexacao.

### MCP Gateway

Implementado:

- endpoint MCP Streamable HTTP em `/mcp`
- `initialize`, `tools/list` e `tools/call` via JSON-RPC MCP
- Validacao de API key quando configurada.
- Tokens opcionais vinculados a workspace.
- Exigencia de workspace nas chamadas.
- Roteamento somente para Code MCP e Git MCP local.
- Schemas fechados e especificos por tool.
- Correlation ID, latencia, status, contagem de resultados e fallback em logs estruturados.
- Orientacao explicita para encaminhar `github_*` ao MCP GitHub dedicado.

### Code MCP

Implementado com dados reais:

- `code.search_code`
- `code.semantic_search_code`
- `code.search_symbol`
- `code.get_class`
- `code.get_method`
- `code.find_references`
- `code.find_callers`
- `code.find_callees`
- `code.find_dependencies`
- `code.explain_architecture`
- `code.analyze_impact`
- `code.search_business_rules`
- `code.research_flow`
- `code.research_continue`

As tools de relacao retornam dados de resolucao quando disponiveis:

- `resolution_status`
- `source_symbol_id`
- `target_symbol_id`
- `target_repository_id`
- `target_repository_name`
- `target_symbol_name`
- `target_symbol_full_name`
- `target_symbol_file_path`
- `target_symbol_start_line`

O ranking amplo usa Reciprocal Rank Fusion e diversificacao por arquivo/repositorio. As sessoes sao persistidas em PostgreSQL. Consultas diretas ao Neo4j para caminhos mais longos continuam como evolucao futura.

### Git MCP

Estado atual: sete tools consultam repositorios reais do workspace com protecao de `REPOS_ROOT`. Pull requests e demais recursos remotos ficam fora deste servidor e devem usar MCP GitHub dedicado.

### Open WebUI

Implementado/configurado:

- Open WebUI sobe com banco PostgreSQL.
- Usa Qdrant como vector DB.
- Usa Ollama/local models.

Pendente/decisao futura:

- Manter Knowledge Bases do Open WebUI independentes dos workspaces tecnicos por decisao de arquitetura.
- Nao sincronizar documentos do Open WebUI para tabelas locais; o Open WebUI permanece como autoridade documental.
- Corrigir experiencia de referencias de documentos quando links internos do Open WebUI nao abrirem corretamente.
- Docling Serve integrado ao Open WebUI com OCR seletivo para PDFs escaneados e imagens.

## Lacunas Tecnicas Conhecidas

1. A indexacao completa ainda precisa de mais fixtures automatizadas por linguagem.
2. A extracao de regras e deterministica; evoluir o corpus de avaliacao automatizada por linguagem e os sinais de corroboracao entre codigo, testes e grafo.
3. O ranking precisa de benchmark com perguntas reais, Recall@k e MRR.
4. Caminhos longos de impacto ainda nao consultam Neo4j diretamente.
5. Nao ha explorador visual do grafo no Admin.
6. Atualizacao Git incremental ainda nao existe.
7. Nao ha controle de permissao por usuario/workspace alem da API key.
8. Nao ha SSO/OIDC.
9. Nao ha reverse proxy/HTTPS pronto para exposicao fora da rede interna.
10. Observabilidade ainda e basica.
11. Backup existe, mas restore/runbook precisa ser detalhado e testado.
12. Descricao semantica de graficos/figuras ainda nao foi habilitada; OCR textual ja e executado pelo Docling no fluxo do Open WebUI.
13. Open WebUI e workspaces locais nao sao sincronizados por decisao de arquitetura e representam dominios distintos.
14. Worker `tree-sitter-indexer` ainda e conceitual/documentado, nao integrado.
15. Imports Protobuf cross-repo por include path e inferencia de consumidor/provedor gRPC ainda nao sao resolvidos de forma semantica.

## Roadmap Recomendado

### Fase 1 - Estabilizacao da Indexacao

Objetivo: transformar a indexacao atual em base confiavel para evolucao.

Itens:

- Criar testes automatizados com fixtures pequenas por linguagem.
- Testar C#, TypeScript, JavaScript, HTML, CSS, Swift, Dart, JSON, YAML, SQL e Protobuf.
- Testar manifestos de dependencia.
- Testar resolucao cross-repo.
- Testar Protobuf com contratos divididos entre repositorios, incluindo imports, RPCs e tipos de request/response.
- Testar concorrencia da fila, retomada apos reinicio e atualizacao do painel durante a escolha de concorrencia.
- Testar cancelamento e reindexacao incremental.
- Adicionar fixtures com arquivos removidos/alterados/inalterados.
- Criar comando de validacao local documentado.

Criterios de aceite:

- Um agente consegue rodar os testes sem subir toda a stack, quando possivel.
- Falhas em extratores por linguagem sao detectadas por fixture.
- Regressao em schema ou resolucao de relacoes quebra teste.
- Um import Protobuf cross-repo nao e marcado como resolvido por engano enquanto o suporte a include paths nao existir.

Arquivos provaveis:

- `apps/admin/src/index.js`
- `apps/admin/package.json`
- `workers/roslyn-indexer/Program.cs`
- `workers/roslyn-indexer/RoslynIndexer.csproj`
- `scripts/init-db.sql`

### Fase 2 - Relacoes Cross-Repo e Code MCP Arquitetural

Objetivo: tornar o MCP util para perguntas de arquitetura e impacto.

Itens:

- Implementar resolucao de imports Protobuf cross-repo por include paths configuraveis.
- Relacionar clientes gRPC, servicos e RPCs quando houver evidencia estatica suficiente no codigo.
- Exibir a confianca/origem da inferencia para evitar tratar convencoes como certeza.
- Implementar `code.explain_architecture` com dados reais.
- Retornar repositorios do workspace, linguagens, arquivos centrais, simbolos centrais e dependencias.
- Criar consulta de impacto por simbolo/arquivo.
- Consultar Neo4j para caminhos entre simbolos/repositorios.
- Melhorar `find_callers` e `find_callees` para priorizar relacoes resolvidas.
- Adicionar filtros por linguagem, repositorio, tipo de simbolo e status de resolucao.

Criterios de aceite:

- Um contrato `.proto` mantido em um repositorio pode ser ligado ao consumidor/provedor em outro repositorio quando o include path estiver configurado.
- Uma chamada MCP consegue explicar a arquitetura basica de um workspace indexado.
- Uma chamada MCP consegue responder impacto de alterar um simbolo.
- Resultados incluem fontes: repositorio, arquivo e linha.

Arquivos provaveis:

- `apps/code-mcp/src/index.js`
- `apps/gateway/src/index.js`
- `docs/mcp-tools.md`

### Fase 3 - Git MCP Real e Atualizacao de Repositorios

Objetivo: conectar codigo indexado com historico Git.

Itens:

- Implementar update de repositorio na Admin UI.
- Executar `git fetch`/`pull` com branch configurada.
- Registrar commit atual no metadata do repositorio.
- Registrar commit indexado no job.
- Implementar Git MCP real:
  - `git.get_history`
  - `git.get_diff`
  - `git.get_commit`
  - `git.get_branch`
  - `git.list_changed_files`
  - `git.find_commits_touching_symbol`
  - `git.search_commit_message`
- Garantir path traversal protection ao executar Git.
- Bloquear comandos Git arbitrarios vindos do payload.

Criterios de aceite:

- Admin UI atualiza repo existente e dispara reindexacao incremental.
- Git MCP retorna historico real limitado ao workspace/repositorio solicitado.
- Nao e possivel acessar repositorios fora de `REPOS_ROOT`.

Arquivos provaveis:

- `apps/admin/src/index.js`
- `apps/admin/public/app.js`
- `apps/admin/public/index.html`
- `apps/git-mcp/src/index.js`
- `docs/mcp-tools.md`

### Fase 4 - Fronteira documental (decisao concluida)

Documentos, regras documentais, permissoes, chunks, embeddings e citacoes pertencem exclusivamente ao Open WebUI. O Gateway, Code MCP e Git MCP nao ingerem, espelham nem consultam essas bases. O servico Knowledge MCP foi removido do runtime Compose e nenhuma tool documental e anunciada.

Tabelas ou codigo legado de prototipos anteriores podem ser removidos em uma migracao destrutiva futura, com backup e janela operacional; eles nao devem voltar ao fluxo ativo.

### Fase 5 - Open WebUI e Workspaces (decisao concluida)

Objetivo: manter os dominios separados e tornar essa separacao explicita.

Itens:

- Open WebUI e autoridade sobre Knowledge Bases, documentos e permissoes documentais.
- Admin Panel e autoridade sobre workspaces tecnicos, repositorios e codigo.
- Nao criar tabela de mapeamento nem rotina de sincronizacao entre esses dominios.
- Manter a decisao explicita no README e na documentacao de arquitetura.

Criterios de aceite:

- Usuario entende em qual workspace esta enviando documentos.
- Admin entende que nao existe equivalente automatico no Open WebUI.
- O teste de isolamento entre Knowledge Bases nao recupera conteudo cruzado.

Arquivos provaveis:

- `apps/admin/src/index.js`
- `apps/admin/public/app.js`
- `docs/workspaces.md`
- `README.md`

### Fase 6 - OCR e Qualidade de Documentos (OCR base implementado)

Objetivo: suportar PDFs escaneados e documentos de baixa qualidade.

Itens:

- Docling Serve integrado como sidecar do Open WebUI.
- EasyOCR local configurado para portugues e ingles.
- OCR seletivo (`force_ocr=false`) para preservar a camada textual quando existente.
- Extracao de layout e tabelas em modo preciso.
- Preservar pagina, bounding boxes quando possivel e texto original.
- Adicionar relatorio de qualidade de documento:
  - paginas processadas
  - paginas com OCR
  - confianca
  - erros
- Melhorar chunking para tabelas/contratos.

Criterios de aceite:

- PDF escaneado com informacao na primeira pagina gera texto recuperavel.
- Open WebUI encontra informacoes textuais presentes em imagem/OCR dentro da base correta.
- Usuario consegue diagnosticar quando OCR falhou.

Arquivos provaveis:

- `docker-compose.yml`
- `docker-compose.mac.yml`
- `docs/open-webui-documents.md`

### Fase 7 - Explorador de Grafo no Admin

Objetivo: permitir auditoria visual e operacional do grafo tecnico.

Itens:

- Tela de grafo por workspace.
- Filtros por repositorio, linguagem, tipo de relacao e status de resolucao.
- Visualizacao de:
  - repositorios
  - arquivos
  - simbolos
  - dependencias
  - chamadas/referencias
- Painel de detalhes do no/aresta.
- Link para arquivo, linha e resultado MCP correspondente.

Criterios de aceite:

- Admin consegue inspecionar porque uma relacao foi resolvida ou ficou pendente.
- Admin consegue filtrar relacoes cross-repo.
- Tela funciona com grafos medios sem travar.

Arquivos provaveis:

- `apps/admin/public/app.js`
- `apps/admin/public/index.html`
- `apps/admin/public/styles.css`
- `apps/admin/src/index.js`

### Fase 8 - Seguranca e Multiusuario

Objetivo: preparar uso real com controle de acesso.

Itens:

- Definir modelo de usuarios e papeis:
  - admin
  - mantenedor de workspace
  - leitor
  - service account
- Implementar controle por workspace.
- Separar API keys por uso:
  - gateway
  - admin
  - automacoes
- Adicionar OIDC/OAuth2 ou integracao corporativa.
- Adicionar rate limit por API key/usuario.
- Revisar logs para evitar vazamento de segredos.
- Garantir que tokens GitHub nunca aparecam em logs.

Criterios de aceite:

- Usuario sem acesso ao workspace nao consulta dados via Admin nem MCP.
- API key pode ser revogada/trocada.
- Auditoria identifica usuario/chave, workspace, tool e timestamp.

Arquivos provaveis:

- `apps/admin/src/index.js`
- `apps/gateway/src/index.js`
- `scripts/init-db.sql`
- `docs/operations.md`

### Fase 9 - Observabilidade e Operacao

Objetivo: tornar a plataforma operavel em servidor real.

Itens:

- Logs estruturados por servico.
- Correlation ID entre Gateway e MCPs.
- Metricas basicas:
  - jobs de indexacao
  - tempo por arquivo
  - falhas por linguagem
  - uso de embeddings
  - tamanho de collections
  - latencia MCP
- Health checks mais profundos.
- Runbook de restore.
- Teste de backup/restore.
- Alertas para containers parados e jobs travados.

Criterios de aceite:

- Admin consegue diagnosticar falha sem entrar no container.
- Existe procedimento documentado para restore.
- Job travado e detectado e exibido.

Arquivos provaveis:

- `scripts/check-health.sh`
- `scripts/backup.sh`
- `docs/operations.md`
- `apps/admin/src/index.js`

### Fase 10 - Hardening para Deploy

Objetivo: preparar exposicao controlada fora do localhost/rede interna.

Itens:

- Reverse proxy.
- HTTPS.
- Headers de seguranca.
- Firewall/documentacao de portas.
- Politica de upgrades de imagens.
- Migracoes versionadas de banco.
- Separar ambiente dev/prod.
- Backup automatizado.
- Retencao de logs.

Criterios de aceite:

- Stack sobe em servidor limpo com runbook.
- Portas expostas sao explicitas.
- Banco pode migrar sem recriacao.
- Backups sao restauraveis.

Arquivos provaveis:

- `docker-compose.yml`
- `.env.example`
- `install.sh`
- `docs/operations.md`
- `README.md`

## Backlog Tecnico Detalhado

### Indexacao

- Adicionar testes automatizados.
- Trocar heuristicas de TS/JS por parser mais robusto quando necessario.
- Avaliar Tree-sitter para linguagens nao C#.
- Melhorar resolucao de imports com aliases (`tsconfig.paths`, Dart packages, Swift modules).
- Evoluir a resolucao Protobuf cross-repo ja suportada por `metadata.proto_include_paths` para dependencias externas fora do workspace.
- Ampliar a inferencia de consumidores/provedores gRPC, que ja registra papel, estrategia e confianca, para mais geradores e frameworks.
- Melhorar resolucao SQL por schema.
- Diferenciar chamadas locais, chamadas externas e chamadas de framework.
- Calcular metricas de centralidade no grafo.
- Manter o commit SHA indexado consistente entre repositorio, job e atualizacoes incrementais.
- Manter cobertura de recuperacao de jobs persistidos apos reinicio; o scheduler ativo permanece em memoria, mas os jobs e a fila ja sao persistidos.
- Adicionar retry por arquivo e por fase.

### Documentos

- Manter o Open WebUI como pipeline e autoridade documental.
- Validar OCR local com corpus real e medir qualidade.
- Melhorar chunking de contratos/tabelas.
- Armazenar pagina e offset.
- Corrigir referencias/citacoes.
- Criar relatorio de qualidade de documentos.
- Avaliar descricao visual de graficos e diagramas com modelo local.

### MCP

- Manter GitHub remoto em um MCP dedicado, sem duplicar credenciais ou tools no Gateway tecnico.
- Evoluir `code.explain_architecture` e `code_analyze_impact`, hoje baseados nos dados reais do indice, com caminhos Neo4j mais longos.
- Avaliar o ranking com corpus real e metricas Recall@k/MRR antes de adicionar cross-encoder local.
- Adicionar paginacao/cursor as tools de grande volume.
- Expandir revisao e feedback das regras de negocio extraidas.

### Admin UI

- Explorador de grafo.
- Update/pull de repositorio.
- Visualizar commit indexado.
- Visualizar logs recentes por job.
- Reprocessar apenas arquivos com erro.
- Reprocessar apenas documentos com erro.
- Melhorar dashboard operacional com historico, nao apenas estado atual.

### Banco e Migracoes

- Criar sistema de migracoes versionadas.
- Evitar depender apenas de `init-db.sql` e `ALTER TABLE` no startup.
- Adicionar indices para consultas mais frequentes conforme uso real.
- Planejar retencao de jobs antigos.
- Planejar limpeza de points orfaos no Qdrant.

### Seguranca

- RBAC por workspace.
- OIDC/OAuth2.
- Rotacao de API keys.
- Redacao de segredos em logs.
- Validacao forte de paths locais.
- Rate limit por chave/usuario.

## Priorizacao Recomendada

Ordem recomendada para proximos agentes:

1. Testes automatizados da indexacao, especialmente incremental, cancelamento, concorrencia e relacoes cross-repo/Protobuf.
2. Update/pull incremental de repositorios e registro do commit indexado.
3. Git MCP real, reutilizando os repositorios ja sincronizados e o commit indexado.
4. Relacoes gRPC cross-repo: include paths Protobuf, consumidores/provedores e nivel de confianca.
5. `code.explain_architecture` real, apoiado pelo grafo e pelas relacoes mais confiaveis.
6. Validar Docling/OCR e isolamento com corpus documental real; melhorar citacoes e chunking no Open WebUI.
7. Explorador visual do grafo.
8. RBAC/SSO.
9. Observabilidade, backup/restore testado e hardening de deploy.

Justificativa:

- A indexacao virou o nucleo tecnico da plataforma; sem testes, cada nova melhoria pode quebrar extratores, fila e resolucao cross-repo.
- Update Git incremental e Git MCP tornam o indice sustentavel em uso diario e fornecem contexto temporal para perguntas arquiteturais.
- Relacoes gRPC cross-repo devem ser melhoradas antes de uma explicacao arquitetural depender delas como fatos.
- Open WebUI e Docling fecham o ciclo de documentos sem acoplar o dominio tecnico.
- Validacao de OCR, grafo visual e seguranca ampliam qualidade e operacao.

## Contratos e Cuidados para Agentes

Ao continuar o desenvolvimento:

- Nao remover mudancas nao commitadas sem pedido explicito.
- Manter modelos locais como padrao.
- Nao reintroduzir `OPENAI_API_KEY` como requisito de instalacao.
- Nao reintroduzir GitHub App sem decisao explicita.
- Preservar escopo por workspace em todas as consultas.
- Nao permitir acesso a arquivos fora de `REPOS_ROOT`.
- Nao usar imagens Docker `latest` ou `main`.
- Preferir alteracoes incrementais e compativeis com bancos existentes.
- Atualizar `scripts/init-db.sql` e migracoes no startup quando adicionar colunas/tabelas.
- Atualizar `README.md` e docs quando alterar comportamento operacional.
- Rodar validacoes antes de finalizar.

## Comandos de Validacao Atuais

Use estes comandos como baseline apos mudancas:

```bash
node --check apps/admin/src/index.js
node --check apps/admin/public/app.js
node --check apps/code-mcp/src/index.js
node --check apps/gateway/src/index.js
node --check apps/git-mcp/src/index.js
./scripts/test-mcp.sh
docker compose config --quiet
bash -n install.sh scripts/create-qdrant-collections.sh scripts/check-health.sh scripts/backup.sh
dotnet build workers/roslyn-indexer/RoslynIndexer.csproj
```

Observacao: `dotnet build` pode gerar `workers/roslyn-indexer/bin/` e `workers/roslyn-indexer/obj/`. Esses diretorios sao artefatos de build e nao devem ser commitados.

## Documentos Relacionados

- `README.md`
- `docs/architecture.md`
- `docs/indexing.md`
- `docs/mcp-tools.md`
- `docs/workspaces.md`
- `docs/operations.md`
- `workers/roslyn-indexer/README.md`
- `workers/tree-sitter-indexer/README.md`
- `workers/graph-builder/README.md`
- `workers/repository-sync/README.md`
