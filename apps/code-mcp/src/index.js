import http from "node:http";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { diversifyEvidence, reciprocalRankFusion } from "./ranking.js";

const { Pool } = pg;

const port = Number(process.env.PORT || 7102);
const serviceName = process.env.SERVICE_NAME || "code-mcp";
const qdrantUrl = process.env.QDRANT_URI || "http://qdrant:6333";
const qdrantApiKey = process.env.QDRANT_API_KEY || "";
const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://ollama:11434";
const embeddingModel = process.env.EMBEDDING_MODEL || "qwen3-embedding:0.6b";
const codeSearchInstruction = "Given a software engineering question in Portuguese or English, retrieve the source-code symbols and excerpts most relevant to answering it, prioritizing exact APIs, implementations, dependencies, and call relationships.";
const codeCollection = "code_symbols";

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "postgres",
  port: Number(process.env.POSTGRES_INTERNAL_PORT || 5432),
  database: process.env.POSTGRES_DB || "ai_platform",
  user: process.env.POSTGRES_USER || "ai_platform",
  password: process.env.POSTGRES_PASSWORD || undefined,
  max: 8
});

const tools = [
  "code_search_symbol", "code_get_class", "code_get_method", "code_find_references", "code_find_callers",
  "code_find_callees", "code_find_dependencies", "code_explain_architecture", "code_search_business_rules",
  "code_search_code", "code_semantic_search_code", "code_analyze_impact", "code_research_flow", "code_research_continue"
];

const researchSessionTtlMs = Math.max(60_000, Number(process.env.RESEARCH_SESSION_TTL_MS || 20 * 60_000));

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function toolNameFromPath(pathname) {
  const prefix = "/tools/";
  return pathname.startsWith(prefix) ? decodeURIComponent(pathname.slice(prefix.length)) : null;
}

function hasWorkspace(payload) {
  return Boolean(payload.workspace_id || payload.workspace_slug);
}

async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function ensureCodeMcpSchema() {
  await query(`CREATE TABLE IF NOT EXISTS code_business_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE, rule_type TEXT NOT NULL,
    statement TEXT NOT NULL, confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    confidence_reason TEXT NOT NULL, review_status TEXT NOT NULL DEFAULT 'proposed', evidence_status TEXT NOT NULL DEFAULT 'observed',
    evidence_score NUMERIC(4,3) NOT NULL DEFAULT 0.500, evidence_count INTEGER NOT NULL DEFAULT 1, semantic JSONB NOT NULL DEFAULT '{}', file_path TEXT NOT NULL,
    language TEXT NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER, symbol_name TEXT, evidence TEXT NOT NULL,
    indexed_commit_sha TEXT, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(), UNIQUE(repository_id, file_path, start_line, rule_type)
  )`);
  await query("ALTER TABLE code_business_rules ADD COLUMN IF NOT EXISTS evidence_status TEXT NOT NULL DEFAULT 'observed'");
  await query("ALTER TABLE code_business_rules ADD COLUMN IF NOT EXISTS evidence_score NUMERIC(4,3) NOT NULL DEFAULT 0.500");
  await query("ALTER TABLE code_business_rules ADD COLUMN IF NOT EXISTS evidence_count INTEGER NOT NULL DEFAULT 1");
  await query("ALTER TABLE code_business_rules ADD COLUMN IF NOT EXISTS semantic JSONB NOT NULL DEFAULT '{}'");
  await query(`CREATE TABLE IF NOT EXISTS code_research_sessions (
    id UUID PRIMARY KEY, workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    repository_id UUID REFERENCES repositories(id) ON DELETE CASCADE, session JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query("CREATE INDEX IF NOT EXISTS idx_code_research_sessions_expires ON code_research_sessions(expires_at)");
}

async function resolveWorkspace(payload) {
  const result = await query(
    "SELECT id, slug, name FROM workspaces WHERE id::text = $1 OR slug = $1",
    [payload.workspace_id || payload.workspace_slug]
  );

  if (!result.rows[0]) {
    const error = new Error("workspace_not_found");
    error.status = 404;
    throw error;
  }

  return result.rows[0];
}

async function executeTool(tool, payload) {
  const workspace = await resolveWorkspace(payload);

  if (tool === "code_search_code" || tool === "code_semantic_search_code") {
    return searchCode(tool, workspace, payload);
  }

  if (tool === "code_search_symbol" || tool === "code_get_class" || tool === "code_get_method") {
    return searchSymbols(tool, workspace, payload);
  }

  if (tool === "code_research_flow") {
    return researchFlow(workspace, payload);
  }

  if (tool === "code_research_continue") {
    return continueResearch(workspace, payload);
  }

  if (tool === "code_search_business_rules") {
    return searchBusinessRules(workspace, payload);
  }

  if (tool === "code_find_references") {
    return searchRelationships(tool, workspace, payload, ["REFERENCES", "IMPORTS", "DEPENDS_ON", "CALLS"]);
  }

  if (tool === "code_find_callers") {
    return searchRelationships(tool, workspace, payload, ["CALLS"], { targetOnly: true });
  }

  if (tool === "code_find_callees") {
    return searchRelationships(tool, workspace, payload, ["CALLS"], { sourceOnly: true });
  }

  if (tool === "code_find_dependencies") {
    return searchRelationships(tool, workspace, payload, ["IMPORTS", "DEPENDS_ON"]);
  }

  if (tool === "code_explain_architecture") {
    return explainArchitecture(workspace, payload);
  }

  if (tool === "code_analyze_impact") {
    return analyzeImpact(workspace, payload);
  }

  const error = new Error("tool_not_implemented");
  error.status = 501;
  throw error;
}

async function explainArchitecture(workspace, payload) {
  const repositoryFilter = payload.repository_id ? "AND r.id = $2" : "";
  const params = payload.repository_id ? [workspace.id, payload.repository_id] : [workspace.id];
  const [repositories, languages, centralSymbols, dependencies, grpc] = await Promise.all([
    query(`SELECT r.id, r.name, r.default_branch, r.status, r.metadata,
                  (SELECT COUNT(*) FROM code_index_files f WHERE f.repository_id = r.id AND f.status = 'indexed')::int AS indexed_files,
                  (SELECT COUNT(*) FROM code_symbols s WHERE s.repository_id = r.id)::int AS symbols
           FROM repositories r
           WHERE r.workspace_id = $1 ${repositoryFilter}
           ORDER BY r.name`, params),
    query(`SELECT f.language, COUNT(*)::int AS files, COUNT(DISTINCT f.repository_id)::int AS repositories
           FROM code_index_files f JOIN repositories r ON r.id = f.repository_id
           WHERE f.workspace_id = $1 AND f.status = 'indexed' ${repositoryFilter}
           GROUP BY f.language ORDER BY files DESC`, params),
    query(`SELECT s.id, s.repository_id, r.name AS repository_name, s.symbol_type, s.name, s.full_name,
                  s.file_path, s.start_line,
                  ((SELECT COUNT(*) FROM code_relationships incoming WHERE incoming.target_symbol_id = s.id) +
                   (SELECT COUNT(*) FROM code_relationships outgoing WHERE outgoing.source_symbol_id = s.id))::int AS degree
           FROM code_symbols s JOIN repositories r ON r.id = s.repository_id
           WHERE s.workspace_id = $1 ${repositoryFilter}
           ORDER BY degree DESC, s.name LIMIT 30`, params),
    query(`SELECT source_repo.id AS source_repository_id, source_repo.name AS source_repository,
                  target_repo.id AS target_repository_id, target_repo.name AS target_repository,
                  cr.relationship_type, COUNT(*)::int AS relationships,
                  ROUND(AVG(COALESCE((cr.resolution_metadata->>'confidence')::numeric, 1)), 2) AS confidence
           FROM code_relationships cr
           JOIN repositories source_repo ON source_repo.id = cr.repository_id
           JOIN repositories target_repo ON target_repo.id = cr.target_repository_id
           WHERE cr.workspace_id = $1 AND cr.target_repository_id <> cr.repository_id ${payload.repository_id ? "AND (cr.repository_id = $2 OR cr.target_repository_id = $2)" : ""}
           GROUP BY source_repo.id, target_repo.id, cr.relationship_type ORDER BY relationships DESC LIMIT 50`, params),
    query(`SELECT cr.repository_id, source_repo.name AS repository_name, cr.source_file_path, cr.start_line,
                  cr.target_repository_id, target_repo.name AS target_repository_name, cr.target_name,
                  cr.relationship_type, cr.resolution_status, cr.resolution_metadata
           FROM code_relationships cr JOIN repositories source_repo ON source_repo.id = cr.repository_id
           LEFT JOIN repositories target_repo ON target_repo.id = cr.target_repository_id
           WHERE cr.workspace_id = $1 AND (cr.language = 'protobuf' OR cr.resolution_metadata->>'domain' = 'grpc')
             ${payload.repository_id ? "AND (cr.repository_id = $2 OR cr.target_repository_id = $2)" : ""}
           ORDER BY COALESCE((cr.resolution_metadata->>'confidence')::numeric, 0) DESC LIMIT 50`, params)
  ]);
  return { status: "ok", tool: "code_explain_architecture", workspace: workspace.slug,
    repository_id: payload.repository_id || null, repositories: repositories.rows, languages: languages.rows,
    central_symbols: centralSymbols.rows, cross_repository_dependencies: dependencies.rows, grpc_relationships: grpc.rows };
}

async function analyzeImpact(workspace, payload) {
  const search = String(payload.symbol || payload.file_path || payload.query || "").trim();
  if (!search) { const error = new Error("symbol_or_file_required"); error.status = 400; throw error; }
  const limit = Math.min(Number(payload.limit || 100), 250);
  const params = [workspace.id, `%${search}%`];
  let repoSql = "";
  if (payload.repository_id) { params.push(payload.repository_id); repoSql = `AND seed.repository_id = $${params.length}`; }
  params.push(limit);
  const result = await query(
    `WITH seed AS (
       SELECT id, repository_id, name, full_name, file_path, start_line FROM code_symbols
       WHERE workspace_id = $1 AND (name ILIKE $2 OR full_name ILIKE $2 OR file_path ILIKE $2)
     ), impacted AS (
       SELECT DISTINCT seed.id AS seed_id, cr.id AS relationship_id, 1 AS depth,
              cr.repository_id, cr.source_name, cr.source_file_path, cr.start_line,
              cr.relationship_type, cr.resolution_status, cr.resolution_metadata
       FROM seed JOIN code_relationships cr ON cr.target_symbol_id = seed.id
       WHERE TRUE ${repoSql}
       UNION
       SELECT DISTINCT seed.id, second.id, 2, second.repository_id, second.source_name,
              second.source_file_path, second.start_line, second.relationship_type,
              second.resolution_status, second.resolution_metadata
       FROM seed
       JOIN code_relationships first ON first.target_symbol_id = seed.id
       JOIN code_relationships second ON second.target_symbol_id = first.source_symbol_id
       WHERE TRUE ${repoSql}
     )
     SELECT impacted.*, seed.name AS changed_symbol, seed.full_name AS changed_symbol_full_name,
            seed.file_path AS changed_file, r.name AS impacted_repository
     FROM impacted JOIN seed ON seed.id = impacted.seed_id JOIN repositories r ON r.id = impacted.repository_id
     ORDER BY impacted.depth, impacted.repository_id, impacted.source_file_path, impacted.start_line
     LIMIT $${params.length}`, params);
  const files = [...new Set(result.rows.map((row) => `${row.impacted_repository}:${row.source_file_path}`))];
  return { status: "ok", tool: "code_analyze_impact", workspace: workspace.slug, query: search,
    summary: { relationships: result.rows.length, impacted_files: files.length, max_depth: result.rows.reduce((m, r) => Math.max(m, r.depth), 0) },
    impacts: result.rows };
}

async function searchRelationships(tool, workspace, payload, relationshipTypes, options = {}) {
  const search = String(payload.symbol || payload.name || payload.query || payload.target || payload.source || "").trim();
  const limit = Math.min(Number(payload.limit || 25), 100);
  const params = [workspace.id, relationshipTypes];
  const filters = ["cr.workspace_id = $1", "cr.relationship_type = ANY($2)"];

  if (search) {
    params.push(`%${search}%`);
    const likeParam = `$${params.length}`;
    if (options.targetOnly) {
      filters.push(`cr.target_name ILIKE ${likeParam}`);
    } else if (options.sourceOnly) {
      filters.push(`(cr.source_name ILIKE ${likeParam} OR cr.source_file_path ILIKE ${likeParam})`);
    } else {
      filters.push(`(cr.target_name ILIKE ${likeParam} OR COALESCE(cr.source_name, '') ILIKE ${likeParam} OR cr.source_file_path ILIKE ${likeParam})`);
    }
  }

  if (payload.repository_id) {
    params.push(payload.repository_id);
    filters.push(`cr.repository_id = $${params.length}`);
  }

  params.push(limit);
  const result = await query(
    `SELECT
       cr.id,
       cr.repository_id,
       cr.relationship_type,
       cr.source_name,
       cr.target_name,
       cr.source_file_path,
       cr.target_file_path,
       cr.language,
       cr.start_line,
       cr.resolution_status,
       cr.resolution_metadata,
       cr.source_symbol_id,
       cr.target_symbol_id,
       cr.target_repository_id,
       target_repo.name AS target_repository_name,
       target_symbol.name AS target_symbol_name,
       target_symbol.full_name AS target_symbol_full_name,
       target_symbol.symbol_type AS target_symbol_type,
       target_symbol.file_path AS target_symbol_file_path,
       target_symbol.start_line AS target_symbol_start_line,
       cr.metadata
     FROM code_relationships cr
     LEFT JOIN repositories target_repo ON target_repo.id = cr.target_repository_id
     LEFT JOIN code_symbols target_symbol ON target_symbol.id = cr.target_symbol_id
     WHERE ${filters.join(" AND ")}
     ORDER BY cr.source_file_path ASC, cr.start_line ASC
     LIMIT $${params.length}`,
    params
  );

  return {
    status: "ok",
    tool,
    workspace: workspace.slug,
    repository_id: payload.repository_id || null,
    query: search || null,
    relationships: result.rows,
    matches: result.rows
  };
}

async function searchCode(tool, workspace, payload) {
  const text = String(payload.query || "").trim();
  const limit = Math.min(Number(payload.limit || 8), 50);

  if (!text) {
    const error = new Error("query_required");
    error.status = 400;
    throw error;
  }

  const terms = extractSearchTerms(text);
  let matches = [];
  let strategy = tool === "code_semantic_search_code" ? "semantic" : "lexical";
  let fallbackUsed = false;

  if (tool === "code_semantic_search_code") {
    try {
      const embedding = await createEmbedding(buildCodeSearchQuery(text));
      const points = await searchQdrant(embedding, workspace.id, payload.repository_id, limit);
      matches = await hydrateQdrantMatches(points);
    } catch {
      strategy = "semantic_unavailable_lexical_fallback";
    }
    if (!matches.length) {
      fallbackUsed = true;
      if (strategy === "semantic") strategy = "semantic_empty_lexical_fallback";
      matches = await searchChunksByTerms(workspace.id, payload.repository_id, text, terms, limit);
    }
  } else {
    matches = await searchChunksByTerms(workspace.id, payload.repository_id, text, terms, limit);
  }

  return {
    status: "ok",
    tool,
    workspace: workspace.slug,
    repository_id: payload.repository_id || null,
    query: text,
    search_strategy: strategy,
    search_terms: terms,
    fallback_used: fallbackUsed,
    matches,
    coverage: await workspaceCoverage(workspace.id, payload.repository_id)
  };
}

async function searchSymbols(tool, workspace, payload) {
  const search = String(payload.symbol || payload.name || payload.query || "").trim();
  const limit = Math.min(Number(payload.limit || 20), 50);

  if (!search) {
    const error = new Error("symbol_query_required");
    error.status = 400;
    throw error;
  }

  const typeFilter = tool === "code_get_class"
    ? ["class", "interface", "record", "struct"]
    : tool === "code_get_method"
      ? ["method", "function"]
      : null;

  const extractedCandidates = extractSymbolCandidates(search);
  const candidates = extractedCandidates.length ? extractedCandidates : [search];
  const params = [workspace.id];
  const candidateFilters = candidates.map((candidate) => {
    params.push(`%${candidate}%`);
    const parameter = `$${params.length}`;
    return `(name ILIKE ${parameter} OR full_name ILIKE ${parameter})`;
  });
  let typeSql = "";
  if (typeFilter) {
    params.push(typeFilter);
    typeSql = `AND symbol_type = ANY($${params.length})`;
  }
  if (payload.repository_id) {
    params.push(payload.repository_id);
    typeSql += ` AND repository_id = $${params.length}`;
  }
  params.push(limit);

  const result = await query(
    `SELECT id, repository_id, symbol_type, name, full_name, language, file_path, start_line, end_line, metadata
     FROM code_symbols
     WHERE workspace_id = $1 AND (${candidateFilters.join(" OR ")})
     ${typeSql}
     ORDER BY
       name ASC
     LIMIT $${params.length}`,
    params
  );

  return {
    status: "ok",
    tool,
    workspace: workspace.slug,
    repository_id: payload.repository_id || null,
    query: search,
    query_interpretation: extractedCandidates.length === 1 && extractedCandidates[0].toLocaleLowerCase() === search.toLocaleLowerCase()
      ? "identifier"
      : "natural_language_or_multiple_terms",
    symbol_candidates: candidates,
    recommended_tool: candidates.length > 1 ? "code_search_code" : null,
    matches: result.rows,
    coverage: await workspaceCoverage(workspace.id, payload.repository_id)
  };
}

const commonSearchTerms = new Set([
  "a", "ao", "aos", "as", "de", "da", "das", "do", "dos", "e", "em", "na", "nas", "no", "nos", "o", "os", "ou", "para", "por", "que", "um", "uma",
  "como", "qual", "quais", "sobre", "com", "sem", "the", "and", "for", "from", "with", "this", "that"
]);

function extractSearchTerms(value) {
  const tokens = String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !commonSearchTerms.has(term.toLocaleLowerCase("pt-BR")));
  return [...new Set(tokens)].slice(0, 12);
}

function extractSymbolCandidates(value) {
  const raw = String(value || "").trim();
  const identifiers = raw.match(/[A-Za-z_][A-Za-z0-9_.-]*/g) || [];
  const candidates = identifiers
    .filter((item) => item.length >= 3 && !commonSearchTerms.has(item.toLocaleLowerCase("pt-BR")))
    .flatMap((item) => [item, ...item.split(/(?=[A-Z])/).filter((part) => part.length >= 3)])
    .filter(Boolean);
  return [...new Set(candidates)].slice(0, 10);
}

async function workspaceCoverage(workspaceId, repositoryId) {
  const params = repositoryId ? [workspaceId, repositoryId] : [workspaceId];
  const repositorySql = repositoryId ? "AND repository_id = $2" : "";
  const result = await query(
    `SELECT
       COUNT(DISTINCT repository_id)::int AS repositories,
       COUNT(*) FILTER (WHERE status = 'indexed')::int AS indexed_files
     FROM code_index_files
     WHERE workspace_id = $1 ${repositorySql}`,
    params
  );
  return result.rows[0] || { repositories: 0, indexed_files: 0 };
}

async function searchBusinessRules(workspace, payload) {
  const text = String(payload.query || "").trim();
  if (!text) { const error = new Error("query_required"); error.status = 400; throw error; }
  const terms = extractSearchTerms(text);
  const usableTerms = terms.length ? terms : [text];
  const params = [workspace.id, Math.max(0, Math.min(1, Number(payload.minimum_confidence ?? 0.5)))];
  const filters = ["workspace_id = $1", "confidence >= $2"];
  const scoreParts = [];
  const matches = [];
  for (const term of usableTerms) {
    params.push(`%${term}%`);
    const position = `$${params.length}`;
    matches.push(`statement ILIKE ${position} OR evidence ILIKE ${position} OR COALESCE(symbol_name, '') ILIKE ${position} OR file_path ILIKE ${position}`);
    scoreParts.push(`CASE WHEN statement ILIKE ${position} THEN 5 ELSE 0 END + CASE WHEN COALESCE(symbol_name, '') ILIKE ${position} THEN 4 ELSE 0 END + CASE WHEN evidence ILIKE ${position} THEN 2 ELSE 0 END + CASE WHEN file_path ILIKE ${position} THEN 3 ELSE 0 END`);
  }
  filters.push(`(${matches.map((match) => `(${match})`).join(" OR ")})`);
  if (payload.repository_id) { params.push(payload.repository_id); filters.push(`repository_id = $${params.length}`); }
  if (payload.rule_type) { params.push(payload.rule_type); filters.push(`rule_type = $${params.length}`); }
  params.push(Math.min(Math.max(Number(payload.limit || 20), 1), 50));
  const result = await query(
    `SELECT id, repository_id, rule_type, statement, confidence::float, confidence_reason, review_status,
            evidence_status, evidence_score::float, evidence_count, semantic,
            file_path, language, start_line, end_line, symbol_name, evidence, indexed_commit_sha, metadata,
            (${scoreParts.join(" + ")})::int AS lexical_score
     FROM code_business_rules WHERE ${filters.join(" AND ")}
     ORDER BY lexical_score DESC, confidence DESC, file_path, start_line LIMIT $${params.length}`,
    params
  );
  return {
    status: "ok", tool: "code_search_business_rules", workspace: workspace.slug,
    repository_id: payload.repository_id || null, query: text, search_terms: usableTerms,
    matches: result.rows,
    caveat: "Regras extraidas deterministicamente representam comportamento observado no codigo. Use evidence_status, pontuacao e evidencias semanticas para avaliar a forca do achado. Documentos permanecem sob responsabilidade do Open WebUI."
  };
}

async function researchFlow(workspace, payload) {
  const question = String(payload.question || payload.query || "").trim();
  const candidateLimit = Math.min(Math.max(Number(payload.candidate_limit || 30), 10), 50);
  const evidenceLimit = Math.min(Math.max(Number(payload.evidence_limit || payload.limit || 10), 3), 15);
  if (!question) {
    const error = new Error("question_required");
    error.status = 400;
    throw error;
  }

  const terms = extractSearchTerms(question);
  const sharedPayload = { ...payload, query: question, limit: candidateLimit };
  const [semantic, lexical, symbolResearch, businessRules, coverage] = await Promise.all([
    searchCode("code_semantic_search_code", workspace, sharedPayload),
    searchCode("code_search_code", workspace, sharedPayload),
    searchSymbols("code_search_symbol", workspace, sharedPayload),
    searchBusinessRules(workspace, { ...sharedPayload, minimum_confidence: 0.5 }).catch(() => ({ matches: [] })),
    workspaceCoverage(workspace.id, payload.repository_id)
  ]);

  const symbols = symbolResearch.matches.slice(0, 10);
  const relationshipResults = await Promise.all(symbols.map((symbol) =>
    searchRelationships("code_find_references", workspace, { ...payload, symbol: symbol.name, limit: 10 }, ["REFERENCES", "IMPORTS", "DEPENDS_ON", "CALLS"])
  ));
  const relationships = deduplicateRelationships(relationshipResults.flatMap((result) => result.relationships));
  const candidates = mergeResearchCandidates(semantic.matches, lexical.matches, terms);
  const session = await createResearchSession({ workspace, repositoryId: payload.repository_id || null, question, terms, coverage, candidates, symbols, relationships, businessRules: businessRules.matches });
  return buildResearchResponse(session, { tool: "code_research_flow", evidenceLimit });
}

async function continueResearch(workspace, payload) {
  const researchId = String(payload.research_id || "").trim();
  const session = await getResearchSession(researchId);
  if (!session || session.workspaceId !== workspace.id || session.repositoryId !== (payload.repository_id || null)) {
    const error = new Error("research_not_found_or_expired");
    error.status = 404;
    throw error;
  }

  const focus = String(payload.focus || payload.query || "").trim();
  const evidenceLimit = Math.min(Math.max(Number(payload.evidence_limit || payload.limit || 10), 3), 15);
  if (focus) {
    const candidateLimit = Math.min(Math.max(Number(payload.candidate_limit || 25), 10), 50);
    const focusPayload = { ...payload, query: focus, limit: candidateLimit, repository_id: session.repositoryId || undefined };
    const [semantic, lexical, symbols, businessRules] = await Promise.all([
      searchCode("code_semantic_search_code", workspace, focusPayload),
      searchCode("code_search_code", workspace, focusPayload),
      searchSymbols("code_search_symbol", workspace, focusPayload),
      searchBusinessRules(workspace, focusPayload).catch(() => ({ matches: [] }))
    ]);
    session.focuses.push(focus);
    session.terms = [...new Set([...session.terms, ...extractSearchTerms(focus)])];
    session.candidates = mergeResearchCandidates([...session.candidates.map((candidate) => candidate.raw), ...semantic.matches], lexical.matches, [...session.terms, ...extractSearchTerms(focus)]);
    session.symbols = deduplicateSymbols([...session.symbols, ...symbols.matches]).slice(0, 20);
    session.businessRules = [...new Map([...(session.businessRules || []), ...businessRules.matches].map((rule) => [rule.id, rule])).values()].slice(0, 30);
  }

  const focusTerms = extractSearchTerms(focus);
  const symbolsToExpand = selectSymbolsForFocus(session.symbols, focusTerms).slice(0, 8);
  if (symbolsToExpand.length) {
    const resultSets = await Promise.all(symbolsToExpand.map((symbol) =>
      searchRelationships("code_find_references", workspace, { repository_id: session.repositoryId || undefined, symbol: symbol.name, limit: 15 }, ["REFERENCES", "IMPORTS", "DEPENDS_ON", "CALLS"])
    ));
    session.relationships = deduplicateRelationships([...session.relationships, ...resultSets.flatMap((result) => result.relationships)]);
  }
  session.updatedAt = Date.now();
  await saveResearchSession(session);
  return buildResearchResponse(session, { tool: "code_research_continue", evidenceLimit, focus });
}

async function createResearchSession({ workspace, repositoryId, question, terms, coverage, candidates, symbols, relationships, businessRules = [] }) {
  const session = {
    id: randomUUID(), workspaceId: workspace.id, workspaceSlug: workspace.slug, repositoryId, question, terms, coverage,
    candidates, symbols: deduplicateSymbols(symbols), relationships, businessRules, focuses: [], createdAt: Date.now(), updatedAt: Date.now()
  };
  await saveResearchSession(session);
  return session;
}

function serializeResearchSession(session) {
  return {
    ...session,
    candidates: session.candidates.map((candidate) => ({ ...candidate, sources: [...candidate.sources] }))
  };
}

function hydrateResearchSession(session) {
  return {
    ...session,
    candidates: (session.candidates || []).map((candidate) => ({ ...candidate, sources: new Set(candidate.sources || []) })),
    businessRules: session.businessRules || []
  };
}

async function saveResearchSession(session) {
  const expiresAt = new Date(Date.now() + researchSessionTtlMs);
  await query(
    `INSERT INTO code_research_sessions (id, workspace_id, repository_id, session, expires_at)
     VALUES ($1,$2,$3,$4::jsonb,$5)
     ON CONFLICT (id) DO UPDATE SET session = EXCLUDED.session, expires_at = EXCLUDED.expires_at, updated_at = NOW()`,
    [session.id, session.workspaceId, session.repositoryId, JSON.stringify(serializeResearchSession(session)), expiresAt]
  );
}

async function getResearchSession(id) {
  if (!id) return null;
  await query("DELETE FROM code_research_sessions WHERE expires_at <= NOW()");
  const result = await query("SELECT session FROM code_research_sessions WHERE id = $1 AND expires_at > NOW()", [id]);
  return result.rows[0] ? hydrateResearchSession(result.rows[0].session) : null;
}

function mergeResearchCandidates(semanticMatches, lexicalMatches, terms) {
  return reciprocalRankFusion({ semantic: semanticMatches, lexical: lexicalMatches }, terms);
}

function selectResearchEvidence(candidates, limit) {
  return diversifyEvidence(candidates, limit).map(compactEvidence);
}

function compactEvidence(candidate) {
  const match = candidate.raw;
  return {
    id: evidenceId(match), repository_id: match.repository_id, file_path: match.file_path, language: match.language,
    start_line: match.start_line, end_line: match.end_line, sources: [...candidate.sources], score: Number(candidate.score.toFixed(6)), ranks: candidate.ranks || {},
    matched_terms: candidate.termCoverage,
    excerpt: String(match.content || "").slice(0, 1200)
  };
}

function evidenceId(match) {
  return `${match.repository_id}:${match.file_path}:${match.chunk_index}`;
}

function deduplicateSymbols(symbols) {
  return [...new Map(symbols.map((symbol) => [symbol.id, symbol])).values()];
}

function deduplicateRelationships(relationships) {
  return [...new Map(relationships.map((relationship) => [relationship.id, relationship])).values()];
}

function selectSymbolsForFocus(symbols, terms) {
  if (!terms.length) return symbols;
  const filtered = symbols.filter((symbol) => {
    const value = `${symbol.name} ${symbol.full_name} ${symbol.file_path}`.toLocaleLowerCase("pt-BR");
    return terms.some((term) => value.includes(term.toLocaleLowerCase("pt-BR")));
  });
  return filtered.length ? filtered : symbols;
}

function buildResearchResponse(session, { tool, evidenceLimit, focus = null }) {
  const evidence = selectResearchEvidence(session.candidates, evidenceLimit);
  const symbols = session.symbols.slice(0, 12).map((symbol) => ({
    id: symbol.id, repository_id: symbol.repository_id, symbol_type: symbol.symbol_type, name: symbol.name,
    full_name: symbol.full_name, file_path: symbol.file_path, start_line: symbol.start_line
  }));
  const relationships = session.relationships.slice(0, 30).map((relationship) => ({
    relationship_type: relationship.relationship_type, source_name: relationship.source_name, target_name: relationship.target_name,
    source_file_path: relationship.source_file_path, target_file_path: relationship.target_file_path,
    target_repository_name: relationship.target_repository_name, start_line: relationship.start_line
  }));
  const businessRules = (session.businessRules || []).slice(0, 15).map((rule) => ({
    id: rule.id, repository_id: rule.repository_id, rule_type: rule.rule_type, statement: rule.statement,
    confidence: rule.confidence, confidence_reason: rule.confidence_reason, review_status: rule.review_status,
    evidence_status: rule.evidence_status, evidence_score: rule.evidence_score, evidence_count: rule.evidence_count, semantic: rule.semantic,
    file_path: rule.file_path, start_line: rule.start_line, end_line: rule.end_line,
    symbol_name: rule.symbol_name, evidence: rule.evidence, indexed_commit_sha: rule.indexed_commit_sha
  }));
  const nextSteps = [];
  if (!evidence.length) nextSteps.push("Nenhuma evidência foi retornada; aprofunde com uma sigla, status, endpoint, evento ou serviço específico.");
  if (symbols.length && !relationships.length) nextSteps.push("Há símbolos, mas não há relações indexadas. Use a continuação com o nome de um símbolo, serviço ou integração encontrada.");
  if (!session.coverage.indexed_files) nextSteps.push("O workspace não possui arquivos indexados disponíveis para esta consulta.");
  return {
    status: "ok", tool, workspace: session.workspaceSlug, repository_id: session.repositoryId,
    research: {
      research_id: session.id, question: session.question, focus, normalized_terms: session.terms,
      coverage: session.coverage, candidate_count: session.candidates.length, evidence_count: evidence.length,
      session_expires_in_seconds: Math.floor(researchSessionTtlMs / 1000), next_cursor: { research_id: session.id }
    },
    evidence, business_rules: businessRules, symbols, relationships, next_steps: nextSteps,
    provenance: { documents_included: false, document_system: "open-webui", ranking: "reciprocal_rank_fusion" }
  };
}

async function createEmbedding(text) {
  const response = await fetch(`${ollamaUrl}/api/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: embeddingModel, prompt: text }),
    signal: AbortSignal.timeout(60_000)
  });

  if (!response.ok) {
    throw new Error(`ollama_embedding_failed_${response.status}`);
  }

  const body = await response.json();
  if (!Array.isArray(body.embedding)) {
    throw new Error("ollama_embedding_missing_vector");
  }

  return body.embedding;
}

function buildCodeSearchQuery(query) {
  return `Instruct: ${codeSearchInstruction}\nQuery: ${query}`;
}

async function searchQdrant(vector, workspaceId, repositoryId, limit) {
  const must = [
    { key: "workspace_id", match: { value: workspaceId } }
  ];
  if (repositoryId) {
    must.push({ key: "repository_id", match: { value: repositoryId } });
  }

  const response = await fetch(`${qdrantUrl}/collections/${codeCollection}/points/search`, {
    method: "POST",
    headers: qdrantHeaders(),
    body: JSON.stringify({
      vector,
      limit,
      with_payload: true,
      filter: { must }
    }),
    signal: AbortSignal.timeout(15_000)
  });

  if (!response.ok) {
    throw new Error(`qdrant_search_failed_${response.status}`);
  }

  const body = await response.json();
  return body.result || [];
}

async function hydrateQdrantMatches(points) {
  if (!points.length) {
    return [];
  }

  const pointIds = points.map((point) => String(point.id));
  const result = await query(
    `SELECT id, repository_id, file_path, language, chunk_index, start_line, end_line, content, qdrant_point_id, metadata
     FROM code_chunks
     WHERE qdrant_point_id = ANY($1)`,
    [pointIds]
  );

  const byPointId = new Map(result.rows.map((row) => [row.qdrant_point_id, row]));
  return points
    .map((point) => {
      const row = byPointId.get(String(point.id));
      if (!row) {
        return null;
      }

      return {
        score: point.score,
        repository_id: row.repository_id,
        file_path: row.file_path,
        language: row.language,
        chunk_index: row.chunk_index,
        start_line: row.start_line,
        end_line: row.end_line,
        content: row.content,
        metadata: row.metadata
      };
    })
    .filter(Boolean);
}

async function searchChunksByTerms(workspaceId, repositoryId, text, terms, limit) {
  const usableTerms = terms.length ? terms : [text];
  const params = [workspaceId];
  const scoreParts = [];
  const matchParts = [];
  for (const term of usableTerms) {
    params.push(`%${term}%`);
    const parameter = `$${params.length}`;
    scoreParts.push(`CASE WHEN content ILIKE ${parameter} THEN 3 ELSE 0 END`);
    scoreParts.push(`CASE WHEN file_path ILIKE ${parameter} THEN 6 ELSE 0 END`);
    matchParts.push(`content ILIKE ${parameter} OR file_path ILIKE ${parameter}`);
  }
  let repositorySql = "";
  if (repositoryId) {
    params.push(repositoryId);
    repositorySql = `AND repository_id = $${params.length}`;
  }
  params.push(limit);

  const result = await query(
    `SELECT id, repository_id, file_path, language, chunk_index, start_line, end_line, content, metadata,
            (${scoreParts.join(" + ")})::int AS lexical_score
     FROM code_chunks
     WHERE workspace_id = $1 AND (${matchParts.map((part) => `(${part})`).join(" OR ")})
     ${repositorySql}
     ORDER BY lexical_score DESC, file_path ASC, chunk_index ASC
     LIMIT $${params.length}`,
    params
  );

  return result.rows.map((row) => ({ score: row.lexical_score, ...row }));
}

function qdrantHeaders() {
  return {
    "content-type": "application/json",
    ...(qdrantApiKey ? { "api-key": qdrantApiKey } : {})
  };
}

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { status: "ok", service: serviceName });
    return;
  }

  if (req.method === "GET" && url.pathname === "/tools") {
    sendJson(res, 200, { service: serviceName, tools, requires_workspace: true });
    return;
  }

  const tool = toolNameFromPath(url.pathname);
  if (req.method !== "POST" || !tool) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }

  if (!tools.includes(tool)) {
    sendJson(res, 404, { error: "unknown_tool", tool });
    return;
  }

  const payload = await readBody(req);
  if (!hasWorkspace(payload)) {
    sendJson(res, 400, { error: "workspace_required" });
    return;
  }

  sendJson(res, 200, await executeTool(tool, payload));
}

await ensureCodeMcpSchema();
http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    const message = error instanceof Error ? error.message : "internal_error";
    sendJson(res, error.status || (message === "invalid_json" ? 400 : 500), { error: message });
  });
}).listen(port, "0.0.0.0", () => {
  console.log(`${serviceName} listening on ${port}`);
});
