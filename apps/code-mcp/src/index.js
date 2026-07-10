import http from "node:http";
import pg from "pg";

const { Pool } = pg;

const port = Number(process.env.PORT || 7102);
const serviceName = process.env.SERVICE_NAME || "code-mcp";
const qdrantUrl = process.env.QDRANT_URI || "http://qdrant:6333";
const qdrantApiKey = process.env.QDRANT_API_KEY || "";
const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://ollama:11434";
const embeddingModel = process.env.EMBEDDING_MODEL || "nomic-embed-text";
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
  "code.search_symbol",
  "code.get_class",
  "code.get_method",
  "code.find_references",
  "code.find_callers",
  "code.find_callees",
  "code.find_dependencies",
  "code.explain_architecture",
  "code.find_related_documents",
  "code.search_code",
  "code.semantic_search_code"
];

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

  if (tool === "code.search_code" || tool === "code.semantic_search_code") {
    return searchCode(tool, workspace, payload);
  }

  if (tool === "code.search_symbol" || tool === "code.get_class" || tool === "code.get_method") {
    return searchSymbols(tool, workspace, payload);
  }

  if (tool === "code.find_references") {
    return searchRelationships(tool, workspace, payload, ["REFERENCES", "IMPORTS", "DEPENDS_ON", "CALLS"]);
  }

  if (tool === "code.find_callers") {
    return searchRelationships(tool, workspace, payload, ["CALLS"], { targetOnly: true });
  }

  if (tool === "code.find_callees") {
    return searchRelationships(tool, workspace, payload, ["CALLS"], { sourceOnly: true });
  }

  if (tool === "code.find_dependencies") {
    return searchRelationships(tool, workspace, payload, ["IMPORTS", "DEPENDS_ON"]);
  }

  return {
    status: "ok",
    tool,
    workspace: workspace.slug,
    repository_id: payload.repository_id || null,
    result: null,
    matches: [],
    relationships: [],
    note: "Consulta real ainda limitada a chunks e simbolos indexados. Use code.search_code, code.semantic_search_code ou code.search_symbol."
  };
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
  const limit = Math.min(Number(payload.limit || 8), 25);

  if (!text) {
    const error = new Error("query_required");
    error.status = 400;
    throw error;
  }

  let matches = [];
  try {
    const embedding = await createEmbedding(text);
    const points = await searchQdrant(embedding, workspace.id, payload.repository_id, limit);
    matches = await hydrateQdrantMatches(points);
  } catch (error) {
    matches = await searchChunksByText(workspace.id, payload.repository_id, text, limit);
  }

  return {
    status: "ok",
    tool,
    workspace: workspace.slug,
    repository_id: payload.repository_id || null,
    query: text,
    matches
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

  const typeFilter = tool === "code.get_class"
    ? ["class", "interface", "record", "struct"]
    : tool === "code.get_method"
      ? ["method", "function"]
      : null;

  const params = [workspace.id, `%${search}%`];
  let typeSql = "";
  if (typeFilter) {
    params.push(typeFilter);
    typeSql = "AND symbol_type = ANY($3)";
  }
  if (payload.repository_id) {
    params.push(payload.repository_id);
    typeSql += ` AND repository_id = $${params.length}`;
  }
  params.push(limit);

  const result = await query(
    `SELECT id, repository_id, symbol_type, name, full_name, language, file_path, start_line, end_line, metadata
     FROM code_symbols
     WHERE workspace_id = $1 AND (name ILIKE $2 OR full_name ILIKE $2)
     ${typeSql}
     ORDER BY
       CASE WHEN lower(name) = lower($2) THEN 0 ELSE 1 END,
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
    matches: result.rows
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

async function searchChunksByText(workspaceId, repositoryId, text, limit) {
  const params = [workspaceId, `%${text}%`];
  let repoSql = "";
  if (repositoryId) {
    params.push(repositoryId);
    repoSql = `AND repository_id = $${params.length}`;
  }
  params.push(limit);

  const result = await query(
    `SELECT id, repository_id, file_path, language, chunk_index, start_line, end_line, content, metadata
     FROM code_chunks
     WHERE workspace_id = $1 AND content ILIKE $2
     ${repoSql}
     ORDER BY file_path ASC, chunk_index ASC
     LIMIT $${params.length}`,
    params
  );

  return result.rows.map((row) => ({ score: null, ...row }));
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

http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    const message = error instanceof Error ? error.message : "internal_error";
    sendJson(res, error.status || (message === "invalid_json" ? 400 : 500), { error: message });
  });
}).listen(port, "0.0.0.0", () => {
  console.log(`${serviceName} listening on ${port}`);
});
