const workspaceProperties = {
  workspace_slug: { type: "string", minLength: 1, description: "Slug do workspace tecnico." },
  workspace_id: { type: "string", format: "uuid", description: "UUID alternativo do workspace tecnico." },
  repository_id: { type: "string", format: "uuid", description: "UUID opcional para restringir a consulta a um repositorio." }
};

const limit = (maximum = 100, fallback = 20) => ({
  type: "integer", minimum: 1, maximum,
  description: `Maximo de resultados (padrao ${fallback}).`
});

const codeSearchProperties = {
  ...workspaceProperties,
  query: { type: "string", minLength: 1, description: "Consulta textual ou pergunta em linguagem natural." },
  limit: limit(50, 8)
};

const symbolProperties = {
  ...workspaceProperties,
  symbol: { type: "string", minLength: 1, description: "Nome simples ou qualificado do simbolo." },
  query: { type: "string", minLength: 1, description: "Alias para symbol." },
  limit: limit(100, 25)
};

const gitProperties = {
  ...workspaceProperties,
  repository: { type: "string", minLength: 1, description: "Nome do repositorio local; obrigatorio quando o workspace possui mais de um repositorio." },
  ref: { type: "string", minLength: 1, description: "Referencia Git local, como HEAD, branch, tag ou SHA." },
  path: { type: "string", minLength: 1, description: "Caminho opcional dentro do repositorio." }
};

const definitions = {
  code_search_code: {
    description: "Busca lexical por termos exatos no codigo e nos caminhos. Use para siglas, estados, mensagens, endpoints e identificadores curtos.",
    properties: codeSearchProperties, anyOf: [{ required: ["query"] }]
  },
  code_semantic_search_code: {
    description: "Busca semantica no codigo indexado. Use uma pergunta completa; faz fallback lexical quando o vetor estiver indisponivel.",
    properties: codeSearchProperties, anyOf: [{ required: ["query"] }]
  },
  code_search_symbol: {
    description: "Localiza classes, metodos, enums, status e outros simbolos por nome. Para perguntas de fluxo, use code_research_flow.",
    properties: symbolProperties, anyOf: [{ required: ["symbol"] }, { required: ["query"] }]
  },
  code_get_class: {
    description: "Localiza classes, interfaces, records e structs por nome.",
    properties: symbolProperties, anyOf: [{ required: ["symbol"] }, { required: ["query"] }]
  },
  code_get_method: {
    description: "Localiza metodos e funcoes por nome.",
    properties: symbolProperties, anyOf: [{ required: ["symbol"] }, { required: ["query"] }]
  },
  code_find_references: {
    description: "Encontra referencias, imports, dependencias e chamadas relacionadas a um simbolo.",
    properties: symbolProperties, anyOf: [{ required: ["symbol"] }, { required: ["query"] }]
  },
  code_find_callers: {
    description: "Encontra simbolos que chamam o metodo ou funcao informado.",
    properties: symbolProperties, anyOf: [{ required: ["symbol"] }, { required: ["query"] }]
  },
  code_find_callees: {
    description: "Encontra chamadas realizadas pelo simbolo informado.",
    properties: symbolProperties, anyOf: [{ required: ["symbol"] }, { required: ["query"] }]
  },
  code_find_dependencies: {
    description: "Encontra imports e dependencias tecnicas relacionadas ao nome informado.",
    properties: symbolProperties, anyOf: [{ required: ["symbol"] }, { required: ["query"] }]
  },
  code_explain_architecture: {
    description: "Resume repositorios, linguagens, simbolos centrais, dependencias cross-repo e relacoes gRPC do workspace.",
    properties: workspaceProperties
  },
  code_analyze_impact: {
    description: "Analisa chamadores diretos e indiretos impactados por uma alteracao de simbolo ou arquivo.",
    properties: {
      ...symbolProperties,
      file_path: { type: "string", minLength: 1, description: "Caminho do arquivo alterado." },
      limit: limit(250, 100)
    },
    anyOf: [{ required: ["symbol"] }, { required: ["query"] }, { required: ["file_path"] }]
  },
  code_search_business_rules: {
    description: "Busca regras de negocio inferidas deterministicamente do codigo. Cada item inclui evidencia, confianca e commit indexado; trate como implementacao observada, nao como politica documental.",
    properties: {
      ...codeSearchProperties,
      rule_type: { type: "string", enum: ["validation", "state_transition", "authorization", "calculation", "integration", "configuration"], description: "Filtro opcional por tipo de regra." },
      minimum_confidence: { type: "number", minimum: 0, maximum: 1, description: "Confianca minima, padrao 0.5." }
    },
    anyOf: [{ required: ["query"] }]
  },
  code_research_flow: {
    description: "Primeira tool para fluxos, regras de negocio, eventos, integracoes e mudancas de status. Combina busca semantica, lexical, regras extraidas, simbolos e relacoes com ranking RRF.",
    properties: {
      ...workspaceProperties,
      question: { type: "string", minLength: 1, description: "Pergunta completa a investigar." },
      candidate_limit: { type: "integer", minimum: 10, maximum: 50, description: "Candidatos internos por estrategia; padrao 30." },
      evidence_limit: { type: "integer", minimum: 3, maximum: 15, description: "Evidencias compactas devolvidas; padrao 10." }
    },
    required: ["question"]
  },
  code_research_continue: {
    description: "Continua uma pesquisa persistida usando um foco especifico; nao repete a recuperacao ampla.",
    properties: {
      ...workspaceProperties,
      research_id: { type: "string", format: "uuid", description: "Cursor retornado por code_research_flow." },
      focus: { type: "string", description: "Simbolo, servico, evento, status ou integracao a aprofundar." },
      candidate_limit: { type: "integer", minimum: 10, maximum: 50 },
      evidence_limit: { type: "integer", minimum: 3, maximum: 15 }
    },
    required: ["research_id"]
  },
  git_get_commit: {
    description: "Le um commit do clone Git local indexado. Nao consulta a API do GitHub.",
    properties: { ...gitProperties, commit: { type: "string", minLength: 1 }, ref: { type: "string", minLength: 1 } }
  },
  git_get_history: {
    description: "Lista o historico do clone Git local, opcionalmente por ref e caminho. Nao consulta pull requests do GitHub.",
    properties: { ...gitProperties, limit: limit(200, 25) }
  },
  git_get_diff: {
    description: "Gera diff entre duas referencias existentes no clone Git local.",
    properties: {
      ...gitProperties,
      from: { type: "string", minLength: 1 }, base: { type: "string", minLength: 1 },
      to: { type: "string", minLength: 1 }, head: { type: "string", minLength: 1 },
      context: { type: "integer", minimum: 0, maximum: 20, description: "Linhas de contexto; padrao 3." }
    }
  },
  git_get_branch: {
    description: "Retorna branch, HEAD e status do clone Git local.",
    properties: gitProperties
  },
  git_list_changed_files: {
    description: "Lista arquivos alterados entre duas referencias no clone Git local.",
    properties: {
      ...gitProperties,
      from: { type: "string", minLength: 1 }, base: { type: "string", minLength: 1 },
      to: { type: "string", minLength: 1 }, head: { type: "string", minLength: 1 }
    }
  },
  git_find_commits_touching_symbol: {
    description: "Pesquisa no patch do historico local commits que alteram um simbolo.",
    properties: { ...gitProperties, symbol: { type: "string", minLength: 1 }, query: { type: "string", minLength: 1 }, limit: limit(200, 25) },
    anyOf: [{ required: ["symbol"] }, { required: ["query"] }]
  },
  git_search_commit_message: {
    description: "Pesquisa mensagens de commit no clone Git local.",
    properties: { ...gitProperties, query: { type: "string", minLength: 1 }, message: { type: "string", minLength: 1 }, limit: limit(200, 25) },
    anyOf: [{ required: ["query"] }, { required: ["message"] }]
  }
};

export const toolRoutes = Object.fromEntries(Object.keys(definitions).map((name) => [name, name.startsWith("git_") ? "git" : "code"]));
export const toolNames = Object.keys(toolRoutes).sort();

export function toolDefinition(name, defaultWorkspaceSlug = "") {
  const definition = definitions[name];
  const properties = structuredClone(definition.properties);
  if (defaultWorkspaceSlug) {
    properties.workspace_slug.description = `Workspace fixado em '${defaultWorkspaceSlug}' pelo endpoint; o argumento informado pelo cliente sera ignorado.`;
  }
  return {
    name,
    title: name.replaceAll("_", " "),
    description: definition.description,
    inputSchema: {
      type: "object",
      properties,
      ...(definition.required ? { required: definition.required } : {}),
      ...(definition.anyOf ? { anyOf: definition.anyOf } : {}),
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  };
}

export function validateToolArguments(name, args, defaultWorkspaceSlug = "") {
  const definition = definitions[name];
  if (!definition) return { error: "unknown_tool" };
  const scoped = { ...(args || {}) };
  if (defaultWorkspaceSlug) {
    delete scoped.workspace_id;
    scoped.workspace_slug = defaultWorkspaceSlug;
  }
  if (!scoped.workspace_id && !scoped.workspace_slug) return { error: "workspace_required" };
  const allowed = new Set(Object.keys(definition.properties));
  const unknown = Object.keys(scoped).filter((key) => !allowed.has(key));
  if (unknown.length) return { error: "invalid_arguments", details: { unknown } };
  const invalid = [];
  for (const [key, value] of Object.entries(scoped)) {
    const schema = definition.properties[key];
    if (schema.type === "string" && typeof value !== "string") invalid.push({ field: key, reason: "string_required" });
    if (schema.type === "string" && typeof value === "string" && schema.minLength && value.trim().length < schema.minLength) invalid.push({ field: key, reason: "empty_string" });
    if (schema.type === "integer" && (!Number.isInteger(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) invalid.push({ field: key, reason: "integer_out_of_range" });
    if (schema.type === "number" && (typeof value !== "number" || !Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) invalid.push({ field: key, reason: "number_out_of_range" });
    if (schema.enum && !schema.enum.includes(value)) invalid.push({ field: key, reason: "unsupported_value", allowed: schema.enum });
    if (schema.format === "uuid" && typeof value === "string" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) invalid.push({ field: key, reason: "invalid_uuid" });
  }
  if (invalid.length) return { error: "invalid_arguments", details: { invalid } };
  const requiredGroups = definition.anyOf || (definition.required ? [{ required: definition.required }] : []);
  if (requiredGroups.length && !requiredGroups.some((group) => group.required.every((key) => scoped[key] !== undefined && String(scoped[key]).trim() !== ""))) {
    return { error: "invalid_arguments", details: { expected_one_of: requiredGroups.map((group) => group.required) } };
  }
  return { args: scoped };
}

export function githubRoutingHint(name) {
  if (name === "git_get_pull_request" || String(name || "").startsWith("github_")) {
    return {
      error: "github_tool_not_available_on_code_gateway",
      requested_tool: name,
      guidance: "Use o servidor MCP GitHub dedicado para pull requests, issues, reviews e operacoes remotas. As tools git_* deste Gateway consultam somente clones locais indexados."
    };
  }
  return null;
}
