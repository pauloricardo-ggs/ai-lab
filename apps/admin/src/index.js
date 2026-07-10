import http from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");

const port = Number(process.env.PORT || 7600);
const reposRoot = process.env.REPOS_ROOT || "/repos";
const adminApiKey = process.env.ADMIN_API_KEY || "";
const gatewayApiKey = process.env.GATEWAY_API_KEY || "";
const qdrantUrl = process.env.QDRANT_URI || "http://qdrant:6333";
const qdrantApiKey = process.env.QDRANT_API_KEY || "";
const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://ollama:11434";
const embeddingModel = process.env.EMBEDDING_MODEL || "nomic-embed-text";
const embeddingVectorSize = Number(process.env.EMBEDDING_VECTOR_SIZE || 768);
const neo4jUrl = process.env.NEO4J_HTTP_URL || "http://neo4j:7474";
const neo4jPassword = process.env.NEO4J_PASSWORD || "";
const roslynIndexerUrl = process.env.ROSLYN_INDEXER_URL || "";
const codeCollection = "code_symbols";
const mcpToolNames = [
  "code.search_symbol", "code.get_class", "code.get_method", "code.find_references", "code.find_callers", "code.find_callees",
  "code.find_dependencies", "code.explain_architecture", "code.find_related_documents", "code.search_code", "code.semantic_search_code",
  "knowledge.search_documents", "knowledge.list_documents", "knowledge.get_document", "knowledge.search_business_rules", "knowledge.search_embeddings",
  "git.get_history", "git.get_diff", "git.get_commit", "git.get_branch", "git.get_pull_request", "git.list_changed_files",
  "git.find_commits_touching_symbol", "git.search_commit_message"
].sort();

const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "bin",
  "obj",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  "target",
  ".venv",
  "venv"
]);

const ignoredFiles = new Set([
  ".DS_Store",
  "Thumbs.db",
  ".npmrc",
  ".pypirc"
]);

const languageByExtension = new Map([
  [".cs", "csharp"],
  [".vb", "vbnet"],
  [".swift", "swift"],
  [".dart", "dart"],
  [".js", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".jsx", "javascript"],
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".py", "python"],
  [".java", "java"],
  [".go", "go"],
  [".rs", "rust"],
  [".php", "php"],
  [".rb", "ruby"],
  [".md", "markdown"],
  [".txt", "text"],
  [".json", "json"],
  [".yml", "yaml"],
  [".yaml", "yaml"],
  [".xml", "xml"],
  [".csproj", "xml"],
  [".fsproj", "xml"],
  [".props", "xml"],
  [".targets", "xml"],
  [".plist", "xml"],
  [".pbxproj", "xcode"],
  [".xcscheme", "xml"],
  [".xcsettings", "xml"],
  [".xcworkspacedata", "xml"],
  [".entitlements", "xml"],
  [".html", "html"],
  [".htm", "html"],
  [".css", "css"],
  [".scss", "css"],
  [".sass", "css"],
  [".less", "css"],
  [".sql", "sql"],
  [".proto", "protobuf"],
  [".sh", "shell"]
]);

const languageByFilename = new Map([
  ["dockerfile", "dockerfile"],
  ["makefile", "makefile"],
  ["package.json", "json"],
  ["package-lock.json", "json"],
  ["pnpm-lock.yaml", "yaml"],
  ["yarn.lock", "yaml"],
  ["pubspec.yaml", "yaml"],
  ["pubspec.lock", "yaml"],
  ["package.swift", "swift"],
  ["podfile", "ruby"],
  ["packages.config", "xml"],
  ["directory.packages.props", "xml"],
  ["license", "text"],
  [".gitignore", "gitignore"],
  [".dockerignore", "dockerignore"],
  [".env.example", "dotenv"]
]);

const maxIndexFileBytes = 512 * 1024;
const chunkLineSize = 120;
const chunkLineOverlap = 20;
const embeddingMaxChars = Math.max(500, Number(process.env.EMBEDDING_MAX_CHARS || 6000));
const embeddingMaxLines = Math.max(1, Number(process.env.EMBEDDING_MAX_LINES || 80));
const embeddingContentMaxChars = Math.max(100, embeddingMaxChars - 800);
const embeddingContentMaxLines = Math.max(1, embeddingMaxLines - 8);
const embeddingTimeoutMs = Math.max(1_000, Number(process.env.EMBEDDING_TIMEOUT_MS || 120000));
const embeddingMaxRetries = Math.max(0, Number(process.env.EMBEDDING_MAX_RETRIES || 2));
const roslynTimeoutMs = Math.max(1_000, Number(process.env.ROSLYN_TIMEOUT_MS || 45000));
const neo4jTimeoutMs = Math.max(1_000, Number(process.env.NEO4J_TIMEOUT_MS || 60000));
const indexFileTimeoutMs = Math.max(1_000, Number(process.env.INDEX_FILE_TIMEOUT_MS || 300000));
const indexIgnoreMigrations = String(process.env.INDEX_IGNORE_MIGRATIONS || "true").toLowerCase() !== "false";
const configuredIndexConcurrency = Math.min(3, Math.max(1, Number(process.env.INDEX_MAX_CONCURRENT_REPOSITORIES || 1)));
const activeIndexJobs = new Map();
const activeIndexStatuses = ["queued", "running", "paused", "canceling"];

class IndexCanceledError extends Error {
  constructor() {
    super("index_canceled");
    this.name = "IndexCanceledError";
  }
}

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "postgres",
  port: Number(process.env.POSTGRES_INTERNAL_PORT || 5432),
  database: process.env.POSTGRES_DB || "ai_platform",
  user: process.env.POSTGRES_USER || "ai_platform",
  password: process.env.POSTGRES_PASSWORD || undefined,
  max: 8
});

const serviceDefinitions = [
  {
    id: "admin",
    name: "Admin Panel",
    kind: "interface",
    description: "Workspaces, repositorios, status operacional e console de tools.",
    healthUrl: null,
    publicPortEnv: "ADMIN_PORT",
    path: "/admin"
  },
  {
    id: "open-webui",
    name: "Open WebUI",
    kind: "interface",
    description: "Chat, Knowledge Bases, modelos, prompts e uso final da plataforma.",
    healthUrl: "http://open-webui:8080",
    publicPortEnv: "OPEN_WEBUI_PORT",
    path: "/"
  },
  {
    id: "qdrant",
    name: "Qdrant",
    kind: "interface",
    description: "Vector database para documentos e simbolos de codigo.",
    healthUrl: "http://qdrant:6333/collections",
    publicPortEnv: "QDRANT_HTTP_PORT",
    path: "/dashboard",
    headers: () => process.env.QDRANT_API_KEY ? { "api-key": process.env.QDRANT_API_KEY } : {}
  },
  {
    id: "ollama",
    name: "Ollama",
    kind: "api",
    description: "Runtime local para modelos open source usados pelo servidor.",
    healthUrl: "http://ollama:11434/api/tags",
    publicPortEnv: "OLLAMA_PORT",
    path: "/"
  },
  {
    id: "neo4j",
    name: "Neo4j",
    kind: "interface",
    description: "Grafo tecnico de simbolos, chamadas e dependencias.",
    healthUrl: "http://neo4j:7474",
    publicPortEnv: "NEO4J_HTTP_PORT",
    path: "/"
  },
  {
    id: "roslyn-indexer",
    name: "Roslyn Indexer",
    kind: "api",
    description: "Parser C# com Roslyn para simbolos, chamadas e referencias.",
    healthUrl: "http://roslyn-indexer:7201/health",
    publicPortEnv: null,
    path: "/health"
  },
  {
    id: "mcp-gateway",
    name: "MCP Gateway",
    kind: "api",
    description: "API para agentes e ferramentas MCP, com roteamento por workspace.",
    healthUrl: null,
    publicPortEnv: "MCP_GATEWAY_PORT",
    path: "/services/mcp-gateway"
  }
];

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendText(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error("payload_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function isAuthorized(req) {
  if (!adminApiKey) {
    return true;
  }

  return req.headers["x-admin-api-key"] === adminApiKey || req.headers["x-api-key"] === adminApiKey;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function assertSafeSegment(value, fieldName) {
  const text = String(value || "");
  if (!/^[a-zA-Z0-9._-]+$/.test(text) || text.includes("..")) {
    const error = new Error(`${fieldName}_invalid`);
    error.status = 400;
    throw error;
  }
  return text;
}

function publicUrl(req, service) {
  if (!service.publicPortEnv && service.id !== "admin") {
    return null;
  }

  const hostHeader = req.headers.host || "localhost";
  const hostname = hostHeader.split(":")[0];
  const proto = req.headers["x-forwarded-proto"] || "http";
  const envPort = process.env[service.publicPortEnv];

  if (service.id === "admin") {
    return `${proto}://${hostHeader}${service.path}`;
  }

  return `${proto}://${hostname}:${envPort}${service.path}`;
}

async function checkService(service) {
  if (!service.healthUrl) {
    return { online: true, latency_ms: 0 };
  }

  const started = Date.now();
  try {
    const response = await fetch(service.healthUrl, {
      headers: service.headers ? service.headers() : {},
      signal: AbortSignal.timeout(2500)
    });

    return {
      online: response.ok,
      latency_ms: Date.now() - started,
      status_code: response.status
    };
  } catch (error) {
    return {
      online: false,
      latency_ms: Date.now() - started,
      error: error instanceof Error ? error.message : "health_check_failed"
    };
  }
}

async function servicesPayload(req) {
  const statuses = await Promise.all(serviceDefinitions.map(async (service) => ({
    id: service.id,
    name: service.name,
    kind: service.kind,
    description: service.description,
    url: publicUrl(req, service),
    can_open: Boolean(service.publicPortEnv) || service.id === "admin",
    ...(await checkService(service))
  })));

  return { services: statuses };
}

function dockerRequest(pathname) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: "/var/run/docker.sock",
        path: pathname,
        method: "GET",
        timeout: 2500
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("docker_api_timeout"));
    });
    request.on("error", reject);
    request.end();
  });
}

async function listContainers() {
  try {
    const containers = await dockerRequest("/containers/json?all=1");
    return {
      containers: containers
        .filter((container) => container.Names?.some((name) => name.startsWith("/ai-")))
        .map((container) => ({
          id: container.Id,
          name: (container.Names?.[0] || "").replace(/^\//, ""),
          image: container.Image,
          state: container.State,
          status: container.Status,
          ports: container.Ports || []
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    };
  } catch (error) {
    return {
      containers: [],
      error: error instanceof Error ? error.message : "docker_api_unavailable"
    };
  }
}

async function mcpGatewayInfo(req) {
  const service = serviceDefinitions.find((item) => item.id === "mcp-gateway");
  const baseUrl = `${publicUrl(req, service).replace(/\/services\/mcp-gateway$/, "")}/mcp`;
  return { base_url: baseUrl, gateway_api_key_configured: Boolean(gatewayApiKey), tools: mcpToolNames };
}

async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return result;
}

async function ensureApplicationSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS code_chunks (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      language TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      start_line INTEGER,
      end_line INTEGER,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      qdrant_collection TEXT,
      qdrant_point_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(repository_id, file_path, chunk_index)
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS code_index_jobs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      scope TEXT NOT NULL DEFAULT 'workspace',
      status TEXT NOT NULL DEFAULT 'pending',
      phase TEXT,
      current_repository TEXT,
      current_file TEXT,
      total_files INTEGER NOT NULL DEFAULT 0,
      files_indexed INTEGER NOT NULL DEFAULT 0,
      total_repository_files INTEGER NOT NULL DEFAULT 0,
      skipped_files INTEGER NOT NULL DEFAULT 0,
      total_chunks INTEGER NOT NULL DEFAULT 0,
      chunks_indexed INTEGER NOT NULL DEFAULT 0,
      symbols_indexed INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 100,
      queue_position INTEGER,
      requested_by TEXT,
      locked_at TIMESTAMP,
      worker_id TEXT,
      started_after TIMESTAMP,
      metrics JSONB NOT NULL DEFAULT '{}',
      started_at TIMESTAMP,
      finished_at TIMESTAMP,
      error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE TABLE IF NOT EXISTS code_index_queue_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    paused BOOLEAN NOT NULL DEFAULT FALSE,
    max_concurrent_repositories INTEGER NOT NULL DEFAULT 1 CHECK (max_concurrent_repositories BETWEEN 1 AND 3),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await query("INSERT INTO code_index_queue_settings (id, max_concurrent_repositories) VALUES (TRUE, $1) ON CONFLICT (id) DO NOTHING", [configuredIndexConcurrency]);
  await query(`
    CREATE TABLE IF NOT EXISTS code_relationships (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL,
      source_name TEXT,
      target_name TEXT NOT NULL,
      source_file_path TEXT NOT NULL,
      target_file_path TEXT,
      language TEXT NOT NULL,
      start_line INTEGER,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS code_index_files (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      language TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      content_hash TEXT,
      status TEXT NOT NULL,
      skipped_reason TEXT,
      error TEXT,
      indexed_at TIMESTAMP,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(repository_id, file_path)
    )
  `);
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'workspace'");
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS phase TEXT");
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS current_repository TEXT");
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS current_file TEXT");
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS total_files INTEGER NOT NULL DEFAULT 0");
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS files_indexed INTEGER NOT NULL DEFAULT 0");
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS total_repository_files INTEGER NOT NULL DEFAULT 0");
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS skipped_files INTEGER NOT NULL DEFAULT 0");
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS total_chunks INTEGER NOT NULL DEFAULT 0");
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS chunks_indexed INTEGER NOT NULL DEFAULT 0");
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS symbols_indexed INTEGER NOT NULL DEFAULT 0");
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMP");
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP");
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS error TEXT");
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 100");
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS queue_position INTEGER");
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS requested_by TEXT");
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP");
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS worker_id TEXT");
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS started_after TIMESTAMP");
  await query("ALTER TABLE code_index_jobs ADD COLUMN IF NOT EXISTS metrics JSONB NOT NULL DEFAULT '{}'");
  await query("ALTER TABLE code_symbols ADD COLUMN IF NOT EXISTS parent_name TEXT");
  await query("ALTER TABLE code_symbols ADD COLUMN IF NOT EXISTS parent_full_name TEXT");
  await query("ALTER TABLE code_relationships ADD COLUMN IF NOT EXISTS source_symbol_id UUID REFERENCES code_symbols(id) ON DELETE SET NULL");
  await query("ALTER TABLE code_relationships ADD COLUMN IF NOT EXISTS target_symbol_id UUID REFERENCES code_symbols(id) ON DELETE SET NULL");
  await query("ALTER TABLE code_relationships ADD COLUMN IF NOT EXISTS target_repository_id UUID REFERENCES repositories(id) ON DELETE SET NULL");
  await query("ALTER TABLE code_relationships ADD COLUMN IF NOT EXISTS resolution_status TEXT NOT NULL DEFAULT 'unresolved'");
  await query("ALTER TABLE code_relationships ADD COLUMN IF NOT EXISTS resolution_metadata JSONB NOT NULL DEFAULT '{}'");
  await query("CREATE INDEX IF NOT EXISTS idx_code_chunks_workspace_id ON code_chunks(workspace_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_chunks_repository_id ON code_chunks(repository_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_chunks_file_path ON code_chunks(file_path)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_symbols_repository_id ON code_symbols(repository_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_symbols_parent_name ON code_symbols(parent_name)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_relationships_workspace_id ON code_relationships(workspace_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_relationships_repository_id ON code_relationships(repository_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_relationships_target_name ON code_relationships(target_name)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_relationships_type ON code_relationships(relationship_type)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_relationships_source_symbol_id ON code_relationships(source_symbol_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_relationships_target_symbol_id ON code_relationships(target_symbol_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_relationships_target_repository_id ON code_relationships(target_repository_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_relationships_resolution_status ON code_relationships(resolution_status)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_index_files_workspace_id ON code_index_files(workspace_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_index_files_repository_id ON code_index_files(repository_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_index_files_status ON code_index_files(status)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_index_jobs_repository_id ON code_index_jobs(repository_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_index_jobs_workspace_id ON code_index_jobs(workspace_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_index_jobs_queue ON code_index_jobs(status, priority, queue_position, created_at)");
  await query("UPDATE code_index_jobs SET status = 'queued', phase = 'queued', locked_at = NULL, worker_id = NULL WHERE status IN ('pending', 'running', 'canceling')");
}

async function listWorkspaces() {
  const result = await query(`
    SELECT
      w.id,
      w.name,
      w.slug,
      w.description,
      w.created_at,
      w.updated_at,
      COUNT(r.id)::int AS repository_count
    FROM workspaces w
    LEFT JOIN repositories r ON r.workspace_id = w.id
    GROUP BY w.id
    ORDER BY w.name ASC
  `);

  return result.rows;
}

async function getWorkspace(idOrSlug) {
  const result = await query(
    "SELECT id, name, slug, description, created_at, updated_at FROM workspaces WHERE id::text = $1 OR slug = $1",
    [idOrSlug]
  );

  return result.rows[0] || null;
}

async function createWorkspace(payload) {
  const name = String(payload.name || "").trim();
  const slug = slugify(payload.slug || name);
  const description = String(payload.description || "").trim();

  if (!name || !slug) {
    const error = new Error("workspace_name_required");
    error.status = 400;
    throw error;
  }

  const result = await query(
    `INSERT INTO workspaces (name, slug, description)
     VALUES ($1, $2, $3)
     RETURNING id, name, slug, description, created_at, updated_at`,
    [name, slug, description || null]
  );

  await fs.mkdir(path.join(reposRoot, slug), { recursive: true });
  return result.rows[0];
}

async function updateWorkspace(idOrSlug, payload) {
  const current = await getWorkspace(idOrSlug);
  if (!current) {
    const error = new Error("workspace_not_found");
    error.status = 404;
    throw error;
  }

  const name = String(payload.name ?? current.name).trim();
  const slug = slugify(payload.slug ?? current.slug);
  const description = String(payload.description ?? current.description ?? "").trim();

  if (!name || !slug) {
    const error = new Error("workspace_name_required");
    error.status = 400;
    throw error;
  }

  const result = await query(
    `UPDATE workspaces
     SET name = $1, slug = $2, description = $3, updated_at = NOW()
     WHERE id = $4
     RETURNING id, name, slug, description, created_at, updated_at`,
    [name, slug, description || null, current.id]
  );

  if (current.slug !== slug) {
    const oldPath = path.join(reposRoot, current.slug);
    const newPath = path.join(reposRoot, slug);
    if (existsSync(oldPath) && !existsSync(newPath)) {
      await fs.rename(oldPath, newPath);
    } else {
      await fs.mkdir(newPath, { recursive: true });
    }
  } else {
    await fs.mkdir(path.join(reposRoot, slug), { recursive: true });
  }

  return result.rows[0];
}

async function deleteWorkspace(idOrSlug) {
  const workspace = await getWorkspace(idOrSlug);
  if (!workspace) {
    const error = new Error("workspace_not_found");
    error.status = 404;
    throw error;
  }

  await fs.rm(path.join(reposRoot, workspace.slug), { recursive: true, force: true });
  await query("DELETE FROM workspaces WHERE id = $1", [workspace.id]);
  return { deleted: true };
}

async function listRepositories(workspaceIdOrSlug) {
  const workspace = await getWorkspace(workspaceIdOrSlug);
  if (!workspace) {
    const error = new Error("workspace_not_found");
    error.status = 404;
    throw error;
  }

  const result = await query(
    `SELECT id, workspace_id, name, provider, url, default_branch, local_path, status, metadata, created_at, updated_at
     FROM repositories
     WHERE workspace_id = $1
     ORDER BY name ASC`,
    [workspace.id]
  );

  return { workspace, repositories: result.rows };
}

async function getRepositoryIndexReport(workspaceIdOrSlug, repositoryId) {
  const workspace = await getWorkspace(workspaceIdOrSlug);
  if (!workspace) {
    const error = new Error("workspace_not_found");
    error.status = 404;
    throw error;
  }

  const repositoryResult = await query(
    `SELECT id, workspace_id, name, provider, url, default_branch, local_path, status, metadata, created_at, updated_at
     FROM repositories
     WHERE id::text = $1 AND workspace_id = $2`,
    [repositoryId, workspace.id]
  );
  const repository = repositoryResult.rows[0];
  if (!repository) {
    const error = new Error("repository_not_found");
    error.status = 404;
    throw error;
  }

  const filesSummary = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'indexed')::int AS indexed,
       COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped,
       COUNT(*) FILTER (WHERE status = 'error')::int AS errors
     FROM code_index_files
     WHERE repository_id = $1`,
    [repository.id]
  );
  const ignoredReasons = await query(
    `SELECT COALESCE(skipped_reason, 'unknown') AS reason, COUNT(*)::int AS count
     FROM code_index_files
     WHERE repository_id = $1 AND status = 'skipped'
     GROUP BY COALESCE(skipped_reason, 'unknown')
     ORDER BY count DESC, reason ASC`,
    [repository.id]
  );
  const symbolsByLanguage = await query(
    `SELECT language, COUNT(*)::int AS count
     FROM code_symbols
     WHERE repository_id = $1
     GROUP BY language
     ORDER BY count DESC, language ASC`,
    [repository.id]
  );
  const filesByLanguage = await query(
    `SELECT COALESCE(language, 'unknown') AS language,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'indexed')::int AS indexed,
            COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped,
            COUNT(*) FILTER (WHERE status = 'error')::int AS errors
     FROM code_index_files
     WHERE repository_id = $1
     GROUP BY COALESCE(language, 'unknown')
     ORDER BY total DESC, language ASC`,
    [repository.id]
  );
  const symbolsByType = await query(
    `SELECT symbol_type AS type, COUNT(*)::int AS count
     FROM code_symbols
     WHERE repository_id = $1
     GROUP BY symbol_type
     ORDER BY count DESC, symbol_type ASC`,
    [repository.id]
  );
  const relationshipsByType = await query(
    `SELECT relationship_type AS type, COUNT(*)::int AS count
     FROM code_relationships
     WHERE repository_id = $1
     GROUP BY relationship_type
     ORDER BY count DESC, relationship_type ASC`,
    [repository.id]
  );
  const relationshipsByResolution = await query(
    `SELECT resolution_status AS status, COUNT(*)::int AS count
     FROM code_relationships
     WHERE repository_id = $1
     GROUP BY resolution_status
     ORDER BY count DESC, status ASC`,
    [repository.id]
  );
  const relationshipsByLanguage = await query(
    `SELECT language,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE resolution_status <> 'unresolved')::int AS resolved,
            COUNT(*) FILTER (WHERE resolution_status = 'unresolved')::int AS unresolved
     FROM code_relationships
     WHERE repository_id = $1
     GROUP BY language
     ORDER BY total DESC, language ASC`,
    [repository.id]
  );
  const fileIssues = await query(
    `SELECT file_path, language, status, skipped_reason, error, metadata, updated_at
     FROM code_index_files
     WHERE repository_id = $1 AND (status IN ('skipped', 'error') OR metadata ? 'failed_chunks')
     ORDER BY status DESC, file_path ASC
     LIMIT 100`,
    [repository.id]
  );
  const latestJob = await query(
    `SELECT id, status, phase, total_files, files_indexed, total_repository_files,
            skipped_files, total_chunks, chunks_indexed, symbols_indexed,
            started_at, finished_at, error, created_at
     FROM code_index_jobs
     WHERE repository_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [repository.id]
  );

  return {
    workspace,
    repository,
    summary: filesSummary.rows[0] || { total: 0, indexed: 0, skipped: 0, errors: 0 },
    ignored_reasons: ignoredReasons.rows,
    files_by_language: filesByLanguage.rows,
    symbols_by_language: symbolsByLanguage.rows,
    symbols_by_type: symbolsByType.rows,
    relationships_by_type: relationshipsByType.rows,
    relationships_by_resolution: relationshipsByResolution.rows,
    relationships_by_language: relationshipsByLanguage.rows,
    file_issues: fileIssues.rows,
    latest_job: latestJob.rows[0] || null
  };
}

async function listWorkspaceIndexJobs(workspaceIdOrSlug, options = {}) {
  const workspace = await getWorkspace(workspaceIdOrSlug);
  if (!workspace) {
    const error = new Error("workspace_not_found");
    error.status = 404;
    throw error;
  }

  const requestedPage = Math.max(1, Number.parseInt(options.page || "1", 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(options.limit || "10", 10) || 10));
  const state = String(options.state || "all");
  const where = ["j.workspace_id = $1"];
  const params = [workspace.id];

  if (state === "running") {
    where.push("j.status = ANY($2::text[])");
    params.push(activeIndexStatuses);
  } else if (state === "finished") {
    where.push("j.status <> ALL($2::text[])");
    params.push(activeIndexStatuses);
  }

  const whereSql = where.join(" AND ");
  const countResult = await query(
    `SELECT COUNT(*)::int AS total
     FROM code_index_jobs j
     WHERE ${whereSql}`,
    params
  );

  const total = Number(countResult.rows[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * limit;
  params.push(limit, offset);
  const result = await query(
    `SELECT
       j.id,
       j.repository_id,
       r.name AS repository_name,
       j.workspace_id,
       j.scope,
       j.status,
       j.phase,
       j.priority,
       j.queue_position,
       j.metrics,
       j.current_repository,
       j.current_file,
       j.total_files,
       j.files_indexed,
       j.total_repository_files,
       j.skipped_files,
       j.total_chunks,
       j.chunks_indexed,
       j.symbols_indexed,
       j.started_at,
       j.started_after,
       j.finished_at,
       j.error,
       j.created_at
     FROM code_index_jobs j
     LEFT JOIN repositories r ON r.id = j.repository_id
     WHERE ${whereSql}
     ORDER BY j.created_at DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );

  return {
    workspace,
    jobs: result.rows,
    queue: await getQueueSettings(),
    pagination: {
      page,
      limit,
      total,
      total_pages: totalPages
    }
  };
}

function runGitClone(url, branch, targetPath) {
  return new Promise((resolve, reject) => {
    const args = ["clone", "--depth", "1"];
    if (branch) {
      args.push("--branch", branch);
    }
    args.push(authenticatedCloneUrl(url), targetPath);

    const child = spawn("git", args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const error = new Error(sanitizeSecret(stderr || stdout || `git_clone_failed_${code}`));
      error.status = 500;
      reject(error);
    });
    child.on("error", reject);
  });
}

function authenticatedCloneUrl(url) {
  const token = process.env.GITHUB_TOKEN || "";
  if (!token || !url.startsWith("https://github.com/")) {
    return url;
  }

  return url.replace("https://github.com/", `https://x-access-token:${encodeURIComponent(token)}@github.com/`);
}

function sanitizeSecret(value) {
  const token = process.env.GITHUB_TOKEN || "";
  if (!token) {
    return value;
  }

  return String(value).replaceAll(token, "***");
}

async function findActiveRepositoryIndex(repositoryId) {
  const result = await query(
    `SELECT id, status, phase
     FROM code_index_jobs
     WHERE repository_id = $1
       AND status = ANY($2::text[])
     ORDER BY created_at DESC
     LIMIT 1`,
    [repositoryId, activeIndexStatuses]
  );
  return result.rows[0] || null;
}

function assertIndexNotCanceled(signal) {
  if (signal?.aborted) {
    throw new IndexCanceledError();
  }
}

function abortSignalWithTimeout(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) {
    return timeoutSignal;
  }
  return AbortSignal.any([signal, timeoutSignal]);
}

async function indexRepository(workspace, repository, jobId) {
  const controller = new AbortController();
  activeIndexJobs.set(jobId, { controller, repositoryId: repository.id, workspaceId: workspace.id });
  let activeFilePath = null;
  const metrics = { scan_ms: 0, parsing_ms: 0, embedding_ms: 0, qdrant_write_ms: 0, postgres_write_ms: 0, neo4j_write_ms: 0, started_at: new Date().toISOString() };
  const persistMetrics = async () => {
    metrics.total_ms = Date.now() - Date.parse(metrics.started_at);
    metrics.files_per_second = metrics.total_ms ? Number(((metrics.files || 0) / (metrics.total_ms / 1000)).toFixed(2)) : 0;
    metrics.chunks_per_minute = metrics.total_ms ? Number(((metrics.chunks || 0) / (metrics.total_ms / 60000)).toFixed(2)) : 0;
    metrics.average_embedding_ms = metrics.chunks ? Math.round(metrics.embedding_ms / metrics.chunks) : 0;
    await query("UPDATE code_index_jobs SET metrics = $2::jsonb WHERE id = $1", [jobId, JSON.stringify(metrics)]);
  };

  try {
    assertIndexNotCanceled(controller.signal);
    await ensureQdrantCollection(codeCollection);
    assertIndexNotCanceled(controller.signal);
    await ensureNeo4jSchema();

    await updateIndexJob(jobId, { phase: "scanning" });
    assertIndexNotCanceled(controller.signal);
    const scanStartedAt = Date.now();
    const scan = await collectIndexableFiles(repository.local_path);
    metrics.scan_ms = Date.now() - scanStartedAt;
    const files = scan.files;
    const previousFiles = await listRepositoryIndexFiles(repository.id);
    const hasFileInventory = previousFiles.size > 0;
    if (!hasFileInventory && await repositoryHasLegacyIndexData(repository.id)) {
      await cleanupRepositoryIndex(repository.id);
      previousFiles.clear();
    }

    const scannedPaths = new Set([...files, ...scan.ignored].map((file) => file.relativePath));
    let deletedFiles = 0;
    for (const [filePath] of previousFiles) {
      assertIndexNotCanceled(controller.signal);
      if (!scannedPaths.has(filePath)) {
        await cleanupFileIndex(repository.id, filePath);
        await query("DELETE FROM code_index_files WHERE repository_id = $1 AND file_path = $2", [repository.id, filePath]);
        deletedFiles += 1;
      }
    }

    for (const ignoredFile of scan.ignored) {
      assertIndexNotCanceled(controller.signal);
      const previous = previousFiles.get(ignoredFile.relativePath);
      if (previous?.status === "indexed") {
        await cleanupFileIndex(repository.id, ignoredFile.relativePath);
      }
      await upsertIndexFileRecord(workspace.id, repository.id, ignoredFile, "skipped", {
        skippedReason: ignoredFile.reason,
        metadata: { incremental: true }
      });
    }

    await updateIndexJob(jobId, {
      phase: "extracting",
      totalFiles: files.length,
      totalRepositoryFiles: scan.stats.totalFiles,
      skippedFiles: scan.stats.skippedFiles
    });

    const graphFiles = [];
    const graphSymbols = [];
    const graphRelationships = [];
    let indexedChunks = 0;
    let indexedSymbols = 0;
    let indexedRelationships = 0;
    let changedFiles = 0;
    let unchangedFiles = 0;
    let erroredFiles = 0;
    let totalChunks = 0;

    for (const file of files) {
      assertIndexNotCanceled(controller.signal);
      activeFilePath = file.relativePath;
      await updateIndexJob(jobId, { currentFile: file.relativePath });

      try {
        const content = await fs.readFile(file.absolutePath, "utf8");
        const contentHash = sha256(content);
        const previous = previousFiles.get(file.relativePath);
        if (previous?.status === "indexed" && previous.content_hash === contentHash) {
          unchangedFiles += 1;
          await incrementIndexJob(jobId, { files: 1 });
          continue;
        }

        changedFiles += 1;
        const fileSignal = abortSignalWithTimeout(controller.signal, indexFileTimeoutMs);
        const parseStartedAt = Date.now();
        const analysis = await analyzeCodeFile(content, file, fileSignal);
        metrics.parsing_ms += Date.now() - parseStartedAt;
        await cleanupFileIndex(repository.id, file.relativePath);
        const fileChunks = splitChunksForEmbedding(chunkContent(content, file, analysis.symbols));
        totalChunks += fileChunks.length;
        await updateIndexJob(jobId, { phase: "embedding", totalChunks });

        const failedChunks = [];
        for (const originalChunk of fileChunks) {
          assertIndexNotCanceled(controller.signal);
          let chunk = originalChunk;
          try {
            const embeddingStartedAt = Date.now();
            let embedding;
            try {
              embedding = await createEmbedding(buildChunkEmbeddingText(chunk), fileSignal);
            } catch (embeddingError) {
              if (!isContextLimitError(embeddingError)) throw embeddingError;
              chunk = truncateChunkForEmbedding(chunk);
              embedding = await createEmbedding(buildChunkEmbeddingText(chunk), fileSignal);
            }
            metrics.embedding_ms += Date.now() - embeddingStartedAt;
            assertIndexNotCanceled(controller.signal);
            const pointId = randomUUID();
            const qdrantStartedAt = Date.now();
            await upsertQdrantPoint(codeCollection, pointId, embedding, {
              workspace_id: workspace.id, workspace_slug: workspace.slug, repository_id: repository.id,
              repository_name: repository.name, source_type: "code", file_path: chunk.file.relativePath,
              language: chunk.file.language, chunk_index: chunk.index, start_line: chunk.startLine, end_line: chunk.endLine
            });
            metrics.qdrant_write_ms += Date.now() - qdrantStartedAt;
            const postgresStartedAt = Date.now();
            await insertCodeChunk(workspace.id, repository.id, chunk, pointId);
            metrics.postgres_write_ms += Date.now() - postgresStartedAt;
            indexedChunks += 1;
            metrics.chunks = indexedChunks;
            await incrementIndexJob(jobId, { chunks: 1 });
          } catch (chunkError) {
            if (chunkError instanceof IndexCanceledError || chunkError.name === "AbortError") throw chunkError;
            failedChunks.push({ index: originalChunk.index, error: String(chunkError?.message || "chunk_index_failed").slice(0, 300) });
          }
        }

        await updateIndexJob(jobId, { phase: "symbols" });
        const postgresStartedAt = Date.now();
        for (const symbol of analysis.symbols) {
          assertIndexNotCanceled(controller.signal);
          await insertCodeSymbol(workspace.id, repository.id, symbol);
        }
        for (const relationship of analysis.relationships) {
          assertIndexNotCanceled(controller.signal);
          await insertCodeRelationship(workspace.id, repository.id, relationship);
        }
        metrics.postgres_write_ms += Date.now() - postgresStartedAt;

        indexedSymbols += analysis.symbols.length;
        indexedRelationships += analysis.relationships.length;
        graphFiles.push(file);
        graphSymbols.push(...analysis.symbols);
        graphRelationships.push(...analysis.relationships);
        await upsertIndexFileRecord(workspace.id, repository.id, file, "indexed", {
          contentHash,
          metadata: {
            incremental: true,
            chunks: fileChunks.length,
            symbols: analysis.symbols.length,
            relationships: analysis.relationships.length,
            subchunks: fileChunks.filter((chunk) => chunk.metadata?.split_reason === "embedding_context_limit").length,
            failed_chunks: failedChunks
          }
        });
        await incrementIndexJob(jobId, { files: 1 });
        metrics.files = (metrics.files || 0) + 1;
      } catch (fileError) {
        if (fileError instanceof IndexCanceledError || fileError.name === "AbortError") {
          throw fileError;
        }
        erroredFiles += 1;
        await cleanupFileIndex(repository.id, file.relativePath).catch((cleanupError) => console.error("file cleanup after index error failed", cleanupError));
        await upsertIndexFileRecord(workspace.id, repository.id, file, "error", {
          error: fileError instanceof Error ? fileError.message.slice(0, 1000) : "file_index_failed"
        });
        await incrementIndexJob(jobId, { files: 1 });
      }
    }
    activeFilePath = null;

    await updateIndexJob(jobId, { phase: "graph", symbols: indexedSymbols });
    assertIndexNotCanceled(controller.signal);
    if (graphFiles.length) {
      const neo4jStartedAt = Date.now();
      await upsertNeo4jRepository(workspace, repository, graphFiles, graphSymbols, graphRelationships);
      metrics.neo4j_write_ms += Date.now() - neo4jStartedAt;
    }
    const resolutionSummary = await resolveWorkspaceRelationships(workspace.id);
    await syncResolvedRelationshipsToNeo4j(workspace.id);
    await linkWorkspaceRelatedSymbols(workspace.id);
    assertIndexNotCanceled(controller.signal);
    await query(
      `UPDATE code_index_jobs
       SET status = 'completed', phase = 'completed', current_file = NULL, files_indexed = $2, chunks_indexed = $3, symbols_indexed = $4, finished_at = NOW()
       WHERE id = $1`,
      [jobId, files.length, indexedChunks, indexedSymbols]
    );
    metrics.files = files.length;
    metrics.chunks = indexedChunks;
    await persistMetrics();

    return {
      files: files.length,
      changed_files: changedFiles,
      unchanged_files: unchangedFiles,
      deleted_files: deletedFiles,
      errored_files: erroredFiles,
      chunks: indexedChunks,
      symbols: indexedSymbols,
      relationships: indexedRelationships,
      resolved_relationships: resolutionSummary.resolved,
      unresolved_relationships: resolutionSummary.unresolved
    };
  } catch (error) {
    metrics.files = metrics.files || 0;
    metrics.chunks = metrics.chunks || 0;
    await persistMetrics().catch((metricsError) => console.error("index metrics persistence failed", metricsError));
    if (error instanceof IndexCanceledError || error.name === "AbortError") {
      if (typeof activeFilePath === "string") {
        await cleanupFileIndex(repository.id, activeFilePath).catch((cleanupError) => console.error("file cleanup after canceled index failed", cleanupError));
      }
      await query(
        `UPDATE code_index_jobs
         SET status = 'canceled', phase = 'canceled', current_file = NULL, error = NULL, finished_at = NOW()
         WHERE id = $1`,
        [jobId]
      );
      throw new IndexCanceledError();
    }

    await query(
      `UPDATE code_index_jobs
       SET status = 'error', phase = 'error', error = $2, finished_at = NOW()
       WHERE id = $1`,
      [jobId, error instanceof Error ? error.message.slice(0, 2000) : "index_failed"]
    );
    throw error;
  } finally {
    activeIndexJobs.delete(jobId);
  }
}

async function enqueueRepositoryIndex(workspace, repository, requestedBy = "admin-ui") {
  const existingJob = await findActiveRepositoryIndex(repository.id);
  if (existingJob) {
    const error = new Error("repository_index_already_running");
    error.status = 409;
    throw error;
  }
  const result = await query(
    `INSERT INTO code_index_jobs (repository_id, workspace_id, scope, status, phase, current_repository, priority, queue_position, requested_by)
     VALUES ($1, $2, 'workspace', 'queued', 'queued', $3, 100,
       (SELECT COALESCE(MAX(queue_position), 0) + 1 FROM code_index_jobs WHERE status IN ('queued', 'paused')), $4)
     RETURNING id`,
    [repository.id, workspace.id, repository.name, requestedBy]
  );
  void runIndexScheduler();
  return result.rows[0].id;
}

async function getQueueSettings() {
  const result = await query("SELECT paused, max_concurrent_repositories FROM code_index_queue_settings WHERE id = TRUE");
  return result.rows[0] || { paused: false, max_concurrent_repositories: configuredIndexConcurrency };
}

let schedulerRunning = false;
async function runIndexScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const settings = await getQueueSettings();
    if (settings.paused) return;
    const available = Math.max(0, Number(settings.max_concurrent_repositories) - activeIndexJobs.size);
    for (let slot = 0; slot < available; slot += 1) {
      const claimed = await query(
        `WITH next_job AS (
           SELECT j.id FROM code_index_jobs j
           WHERE j.status = 'queued'
             AND NOT EXISTS (SELECT 1 FROM code_index_jobs active WHERE active.repository_id = j.repository_id AND active.status IN ('running', 'canceling'))
           ORDER BY j.priority ASC, j.queue_position ASC NULLS LAST, j.created_at ASC
           FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE code_index_jobs j SET status = 'running', phase = 'preparing', started_at = NOW(), started_after = NOW(), locked_at = NOW(), worker_id = $1
         FROM next_job WHERE j.id = next_job.id
         RETURNING j.id, j.repository_id, j.workspace_id`,
        [`admin-${process.pid}`]
      );
      const job = claimed.rows[0];
      if (!job) break;
      const details = await query(
        `SELECT w.id AS workspace_id, w.slug AS workspace_slug, w.name AS workspace_name,
                r.id AS repository_id, r.name AS repository_name, r.local_path, r.url, r.default_branch, r.status, r.metadata
         FROM code_index_jobs j JOIN workspaces w ON w.id = j.workspace_id JOIN repositories r ON r.id = j.repository_id WHERE j.id = $1`, [job.id]
      );
      const row = details.rows[0];
      if (!row) continue;
      const workspace = { id: row.workspace_id, slug: row.workspace_slug, name: row.workspace_name };
      const repository = { id: row.repository_id, workspace_id: row.workspace_id, name: row.repository_name, local_path: row.local_path, url: row.url, default_branch: row.default_branch, status: row.status, metadata: row.metadata };
      startRepositoryIndex(workspace, repository, job.id);
    }
  } finally {
    schedulerRunning = false;
  }
}

function startRepositoryIndex(workspace, repository, jobId) {
  indexRepository(workspace, repository, jobId)
    .then(async (indexResult) => {
      await query(
        `UPDATE repositories
         SET status = $2, metadata = metadata || $3::jsonb, updated_at = NOW()
         WHERE id = $1`,
        [
          repository.id,
          Number(indexResult.errored_files || 0) > 0 ? "indexed_with_errors" : "indexed",
          JSON.stringify({ index: indexResult })
        ]
      );
    })
    .catch(async (error) => {
      console.error("repository index failed", error);
      if (error instanceof IndexCanceledError || error.message === "index_canceled") {
        await query(
          `UPDATE repositories
           SET status = 'index_canceled', metadata = metadata || $2::jsonb, updated_at = NOW()
           WHERE id = $1`,
          [repository.id, JSON.stringify({ index_canceled: new Date().toISOString() })]
        ).catch((updateError) => console.error("repository canceled index status update failed", updateError));
        return;
      }

      await query(
        `UPDATE repositories
         SET status = 'index_error', metadata = metadata || $2::jsonb, updated_at = NOW()
         WHERE id = $1`,
        [repository.id, JSON.stringify({ index_error: error instanceof Error ? error.message.slice(0, 1000) : "index_failed" })]
      ).catch((updateError) => console.error("repository index status update failed", updateError));
    }).finally(() => void runIndexScheduler());
}

async function updateIndexJob(jobId, changes) {
  const assignments = [];
  const params = [jobId];

  const mapping = {
    phase: "phase",
    currentRepository: "current_repository",
    currentFile: "current_file",
    totalFiles: "total_files",
    totalRepositoryFiles: "total_repository_files",
    skippedFiles: "skipped_files",
    totalChunks: "total_chunks",
    symbols: "symbols_indexed"
  };

  for (const [key, column] of Object.entries(mapping)) {
    if (Object.hasOwn(changes, key)) {
      params.push(changes[key]);
      assignments.push(`${column} = $${params.length}`);
    }
  }

  if (!assignments.length) {
    return;
  }

  await query(`UPDATE code_index_jobs SET ${assignments.join(", ")} WHERE id = $1`, params);
}

async function incrementIndexJob(jobId, increments) {
  const assignments = [];
  const params = [jobId];

  if (increments.files) {
    params.push(increments.files);
    assignments.push(`files_indexed = files_indexed + $${params.length}`);
  }
  if (increments.chunks) {
    params.push(increments.chunks);
    assignments.push(`chunks_indexed = chunks_indexed + $${params.length}`);
  }

  if (!assignments.length) {
    return;
  }

  await query(`UPDATE code_index_jobs SET ${assignments.join(", ")} WHERE id = $1`, params);
}

async function cleanupRepositoryIndex(repositoryId) {
  await deleteQdrantRepositoryPoints(repositoryId);
  await deleteNeo4jRepository(repositoryId);
  await query("DELETE FROM code_index_files WHERE repository_id = $1", [repositoryId]);
  await query("DELETE FROM code_relationships WHERE repository_id = $1", [repositoryId]);
  await query("DELETE FROM code_symbols WHERE repository_id = $1", [repositoryId]);
  await query("DELETE FROM code_chunks WHERE repository_id = $1", [repositoryId]);
}

async function cleanupFileIndex(repositoryId, filePath) {
  await deleteQdrantFilePoints(repositoryId, filePath);
  await deleteNeo4jFile(repositoryId, filePath);
  await query("DELETE FROM code_relationships WHERE repository_id = $1 AND source_file_path = $2", [repositoryId, filePath]);
  await query("DELETE FROM code_symbols WHERE repository_id = $1 AND file_path = $2", [repositoryId, filePath]);
  await query("DELETE FROM code_chunks WHERE repository_id = $1 AND file_path = $2", [repositoryId, filePath]);
}

async function listRepositoryIndexFiles(repositoryId) {
  const result = await query(
    `SELECT file_path, language, size_bytes, content_hash, status, skipped_reason, error
     FROM code_index_files
     WHERE repository_id = $1`,
    [repositoryId]
  );
  return new Map(result.rows.map((row) => [row.file_path, row]));
}

async function upsertIndexFileRecord(workspaceId, repositoryId, file, status, details = {}) {
  await query(
    `INSERT INTO code_index_files (
      workspace_id, repository_id, file_path, language, size_bytes, content_hash,
      status, skipped_reason, error, indexed_at, metadata, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
    ON CONFLICT (repository_id, file_path)
    DO UPDATE SET
      workspace_id = EXCLUDED.workspace_id,
      language = EXCLUDED.language,
      size_bytes = EXCLUDED.size_bytes,
      content_hash = EXCLUDED.content_hash,
      status = EXCLUDED.status,
      skipped_reason = EXCLUDED.skipped_reason,
      error = EXCLUDED.error,
      indexed_at = EXCLUDED.indexed_at,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()`,
    [
      workspaceId,
      repositoryId,
      file.relativePath,
      file.language || null,
      file.size || 0,
      details.contentHash || null,
      status,
      details.skippedReason || null,
      details.error || null,
      status === "indexed" ? new Date().toISOString() : null,
      details.metadata || {}
    ]
  );
}

async function repositoryHasLegacyIndexData(repositoryId) {
  const result = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM code_chunks WHERE repository_id = $1) AS chunks,
       (SELECT COUNT(*)::int FROM code_symbols WHERE repository_id = $1) AS symbols,
       (SELECT COUNT(*)::int FROM code_relationships WHERE repository_id = $1) AS relationships`,
    [repositoryId]
  );
  const row = result.rows[0] || {};
  return Number(row.chunks || 0) > 0 || Number(row.symbols || 0) > 0 || Number(row.relationships || 0) > 0;
}

async function resolveWorkspaceRelationships(workspaceId) {
  const [relationships, symbols, repositories, files] = await Promise.all([
    query(
      `SELECT id, repository_id, relationship_type, source_name, target_name, source_file_path,
              target_file_path, language, start_line
       FROM code_relationships
       WHERE workspace_id = $1`,
      [workspaceId]
    ),
    query(
      `SELECT id, repository_id, symbol_type, name, full_name, language,
              file_path, start_line, end_line, parent_name, parent_full_name
       FROM code_symbols
       WHERE workspace_id = $1`,
      [workspaceId]
    ),
    query(
      `SELECT id, name, url
       FROM repositories
       WHERE workspace_id = $1`,
      [workspaceId]
    ),
    query(
      `SELECT repository_id, file_path, language
       FROM code_index_files
       WHERE workspace_id = $1 AND status = 'indexed'`,
      [workspaceId]
    )
  ]);

  const context = buildRelationshipResolutionContext(symbols.rows, repositories.rows, files.rows);
  let resolved = 0;
  let unresolved = 0;

  for (const relationship of relationships.rows) {
    const resolution = resolveRelationship(relationship, context);
    if (resolution.status === "unresolved") {
      unresolved += 1;
    } else {
      resolved += 1;
    }
    await query(
      `UPDATE code_relationships
       SET source_symbol_id = $2,
           target_symbol_id = $3,
           target_repository_id = $4,
           target_file_path = $5,
           resolution_status = $6,
           resolution_metadata = $7
       WHERE id = $1`,
      [
        relationship.id,
        resolution.sourceSymbolId || null,
        resolution.targetSymbolId || null,
        resolution.targetRepositoryId || null,
        resolution.targetFilePath || null,
        resolution.status,
        resolution.metadata || {}
      ]
    );
  }

  return { resolved, unresolved };
}

function buildRelationshipResolutionContext(symbols, repositories, files) {
  const symbolsByRepo = new Map();
  const filesByRepo = new Map();
  const repositoriesByNormalizedName = new Map();

  for (const symbol of symbols) {
    const items = symbolsByRepo.get(symbol.repository_id) || [];
    items.push(symbol);
    symbolsByRepo.set(symbol.repository_id, items);
  }

  for (const file of files) {
    const items = filesByRepo.get(file.repository_id) || [];
    items.push(file);
    filesByRepo.set(file.repository_id, items);
  }

  for (const repository of repositories) {
    repositoriesByNormalizedName.set(normalizeLookupName(repository.name), repository);
    const urlName = normalizeLookupName(inferRepoName(repository.url || repository.name));
    if (urlName) {
      repositoriesByNormalizedName.set(urlName, repository);
    }
  }

  return { symbols, symbolsByRepo, repositories, repositoriesByNormalizedName, filesByRepo };
}

function resolveRelationship(relationship, context) {
  const sourceSymbol = findSourceSymbol(relationship, context);
  const baseResolution = {
    sourceSymbolId: sourceSymbol?.id || null,
    targetSymbolId: null,
    targetRepositoryId: null,
    targetFilePath: null,
    status: "unresolved",
    metadata: {}
  };

  const localFile = resolveFileTarget(relationship, context);
  if (localFile) {
    return {
      ...baseResolution,
      targetRepositoryId: localFile.repository_id,
      targetFilePath: localFile.file_path,
      status: "resolved_file",
      metadata: { strategy: localFile.strategy }
    };
  }

  const symbol = findTargetSymbol(relationship, context);
  if (symbol) {
    return {
      ...baseResolution,
      targetSymbolId: symbol.id,
      targetRepositoryId: symbol.repository_id,
      targetFilePath: symbol.file_path,
      status: "resolved_symbol",
      metadata: {
        strategy: symbol.repository_id === relationship.repository_id ? "same_repository_symbol" : "workspace_symbol",
        symbol_type: symbol.symbol_type,
        symbol_name: symbol.name,
        symbol_full_name: symbol.full_name
      }
    };
  }

  const repository = resolveRepositoryTarget(relationship.target_name, context);
  if (repository) {
    return {
      ...baseResolution,
      targetRepositoryId: repository.id,
      status: "resolved_repository",
      metadata: { strategy: "workspace_repository_name", repository_name: repository.name }
    };
  }

  return baseResolution;
}

function findSourceSymbol(relationship, context) {
  const candidates = context.symbolsByRepo.get(relationship.repository_id) || [];
  const line = Number(relationship.start_line || 0);
  const sourceName = normalizeLookupName(relationship.source_name || "");
  return candidates
    .filter((symbol) => symbol.file_path === relationship.source_file_path)
    .filter((symbol) => !sourceName || normalizeLookupName(symbol.name) === sourceName || normalizeLookupName(symbol.full_name).endsWith(sourceName))
    .filter((symbol) => !line || (Number(symbol.start_line || 0) <= line && Number(symbol.end_line || symbol.start_line || 0) >= line))
    .sort((a, b) => Number(b.start_line || 0) - Number(a.start_line || 0))[0] || null;
}

function findTargetSymbol(relationship, context) {
  const targetNames = targetLookupNames(relationship.target_name);
  if (!targetNames.length) {
    return null;
  }

  const sameRepository = context.symbolsByRepo.get(relationship.repository_id) || [];
  const sameRepoMatch = rankTargetSymbols(relationship, sameRepository, targetNames)[0];
  if (sameRepoMatch) {
    return sameRepoMatch.symbol;
  }

  const workspaceMatches = rankTargetSymbols(relationship, context.symbols, targetNames);
  return workspaceMatches[0]?.symbol || null;
}

function rankTargetSymbols(relationship, symbols, targetNames) {
  const normalizedTargets = new Set(targetNames.map(normalizeLookupName));
  return symbols
    .map((symbol) => {
      const name = normalizeLookupName(symbol.name);
      const fullName = normalizeLookupName(symbol.full_name);
      let score = 0;
      if (normalizedTargets.has(name)) {
        score += 80;
      }
      if ([...normalizedTargets].some((target) => fullName.endsWith(target))) {
        score += 50;
      }
      if (symbol.language === relationship.language) {
        score += 15;
      }
      if (symbol.file_path === relationship.source_file_path) {
        score += 10;
      }
      if (symbol.repository_id === relationship.repository_id) {
        score += 10;
      }
      return { symbol, score };
    })
    .filter((item) => item.score >= 50)
    .sort((a, b) => b.score - a.score || Number(a.symbol.start_line || 0) - Number(b.symbol.start_line || 0));
}

function resolveFileTarget(relationship, context) {
  const files = context.filesByRepo.get(relationship.repository_id) || [];
  const target = relationship.target_file_path || relationship.target_name;
  if (!target || !isPathLikeTarget(target)) {
    return null;
  }

  const candidates = candidateImportPaths(relationship.source_file_path, target, relationship.language);
  for (const candidate of candidates) {
    const file = files.find((item) => normalizePathForLookup(item.file_path) === normalizePathForLookup(candidate));
    if (file) {
      return { ...file, strategy: "relative_import_path" };
    }
  }
  return null;
}

function resolveRepositoryTarget(targetName, context) {
  const normalized = normalizeLookupName(normalizeDependencyName(targetName));
  if (!normalized) {
    return null;
  }
  return context.repositoriesByNormalizedName.get(normalized) || null;
}

function candidateImportPaths(sourceFilePath, target, language) {
  const sourceDir = path.posix.dirname(sourceFilePath.split(path.sep).join(path.posix.sep));
  const normalizedTarget = target.split(path.sep).join(path.posix.sep).replace(/[?#].*$/, "");
  const base = normalizedTarget.startsWith("/")
    ? normalizedTarget.replace(/^\/+/, "")
    : normalizedTarget.startsWith(".")
      ? path.posix.normalize(path.posix.join(sourceDir, normalizedTarget))
      : normalizedTarget;
  const extensions = importExtensionsForLanguage(language);
  const candidates = [base];
  if (!path.posix.extname(base)) {
    for (const extension of extensions) {
      candidates.push(`${base}${extension}`);
      candidates.push(path.posix.join(base, `index${extension}`));
    }
  }
  return candidates;
}

function importExtensionsForLanguage(language) {
  if (["javascript", "typescript"].includes(language)) {
    return [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];
  }
  if (language === "dart") {
    return [".dart"];
  }
  if (language === "swift") {
    return [".swift"];
  }
  if (language === "html") {
    return [".html", ".htm", ".css", ".js"];
  }
  if (language === "css") {
    return [".css", ".scss", ".sass", ".less"];
  }
  if (language === "protobuf") {
    return [".proto"];
  }
  return ["", ".json", ".yaml", ".yml", ".sql"];
}

function targetLookupNames(targetName) {
  const value = String(targetName || "").trim();
  if (!value) {
    return [];
  }
  const withoutGenerics = value.replace(/<.*>/g, "");
  const parts = withoutGenerics.split(/[.#/\\]/).filter(Boolean);
  return [...new Set([value, withoutGenerics, parts.at(-1)].filter(Boolean))];
}

function isPathLikeTarget(target) {
  return String(target || "").startsWith(".")
    || String(target || "").startsWith("/")
    || /[/\\]/.test(String(target || ""))
    || Boolean(path.posix.extname(String(target || "")));
}

function normalizePathForLookup(value) {
  return path.posix.normalize(String(value || "").split(path.sep).join(path.posix.sep)).replace(/^\.\//, "");
}

function normalizeLookupName(value) {
  return String(value || "").trim().toLowerCase().replace(/\.git$/, "").replace(/[^a-z0-9_./@-]+/g, "");
}

async function insertCodeChunk(workspaceId, repositoryId, chunk, pointId) {
  await query(
    `INSERT INTO code_chunks (
      workspace_id, repository_id, file_path, language, chunk_index,
      start_line, end_line, content, content_hash, qdrant_collection, qdrant_point_id, metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (repository_id, file_path, chunk_index)
    DO UPDATE SET
      content = EXCLUDED.content,
      content_hash = EXCLUDED.content_hash,
      qdrant_collection = EXCLUDED.qdrant_collection,
      qdrant_point_id = EXCLUDED.qdrant_point_id,
      metadata = EXCLUDED.metadata`,
    [
      workspaceId,
      repositoryId,
      chunk.file.relativePath,
      chunk.file.language,
      chunk.index,
      chunk.startLine,
      chunk.endLine,
      chunk.content,
      sha256(chunk.content),
      codeCollection,
      pointId,
      { indexed_by: "admin-ui", embedding_model: embeddingModel, ...(chunk.metadata || {}) }
    ]
  );
}

async function insertCodeSymbol(workspaceId, repositoryId, symbol) {
  await query(
    `INSERT INTO code_symbols (
      workspace_id, repository_id, symbol_type, name, full_name, language,
      file_path, start_line, end_line, parent_name, parent_full_name, metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      workspaceId,
      repositoryId,
      symbol.type,
      symbol.name,
      symbol.fullName,
      symbol.language,
      symbol.filePath,
      symbol.line,
      symbol.endLine || symbol.line,
      symbol.parentName || null,
      symbol.parentFullName || null,
      { indexed_by: "admin-ui", ...(symbol.metadata || {}) }
    ]
  );
}

async function insertCodeRelationship(workspaceId, repositoryId, relationship) {
  await query(
    `INSERT INTO code_relationships (
      workspace_id, repository_id, relationship_type, source_name, target_name,
      source_file_path, target_file_path, language, start_line, metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      workspaceId,
      repositoryId,
      relationship.type,
      relationship.sourceName,
      relationship.targetName,
      relationship.sourceFilePath,
      relationship.targetFilePath || null,
      relationship.language,
      relationship.line,
      relationship.metadata || {}
    ]
  );
}

async function collectIndexableFiles(rootPath) {
  const root = path.resolve(rootPath);
  const files = [];
  const ignored = [];
  const stats = {
    totalFiles: 0,
    skippedFiles: 0
  };

  async function visit(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          await visit(absolutePath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      stats.totalFiles += 1;

      const stat = await fs.stat(absolutePath);
      const relativePath = path.relative(root, absolutePath);
      const normalizedRelativePath = relativePath.split(path.sep).join("/");
      const isSnapshot = entry.name.endsWith("Snapshot.cs");
      if (indexIgnoreMigrations && !isSnapshot && entry.name.endsWith(".cs") && /(^|\/)migrations\//i.test(normalizedRelativePath)) {
        stats.skippedFiles += 1;
        ignored.push({ absolutePath, relativePath, size: stat.size, language: "csharp", reason: "migration_file" });
        continue;
      }
      if (stat.size > maxIndexFileBytes) {
        stats.skippedFiles += 1;
        ignored.push({
          absolutePath,
          relativePath,
          size: stat.size,
          reason: "file_too_large"
        });
        continue;
      }

      const language = await inferFileLanguage(absolutePath, entry.name);
      if (!language) {
        stats.skippedFiles += 1;
        ignored.push({
          absolutePath,
          relativePath,
          size: stat.size,
          reason: "unsupported_or_binary"
        });
        continue;
      }

      files.push({
        absolutePath,
        relativePath,
        language,
        size: stat.size
      });
    }
  }

  await visit(root);
  return { files, ignored, stats };
}

async function inferFileLanguage(absolutePath, fileName) {
  const normalizedName = fileName.toLowerCase();
  if (ignoredFiles.has(fileName) || ignoredFiles.has(normalizedName)) {
    return null;
  }

  if (normalizedName.startsWith(".env") && normalizedName !== ".env.example") {
    return null;
  }

  const byFilename = languageByFilename.get(normalizedName);
  if (byFilename) {
    return byFilename;
  }

  const extension = path.extname(fileName).toLowerCase();
  const byExtension = languageByExtension.get(extension);
  if (byExtension) {
    return byExtension;
  }

  if (await looksLikeTextFile(absolutePath)) {
    return "text";
  }

  return null;
}

async function looksLikeTextFile(absolutePath) {
  const handle = await fs.open(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead === 0) {
      return true;
    }

    const sample = buffer.subarray(0, bytesRead);
    let controlBytes = 0;
    for (const byte of sample) {
      if (byte === 0) {
        return false;
      }
      const isAllowedControl = byte === 9 || byte === 10 || byte === 12 || byte === 13;
      if (byte < 32 && !isAllowedControl) {
        controlBytes += 1;
      }
    }

    return controlBytes / bytesRead < 0.08;
  } finally {
    await handle.close();
  }
}

function chunkContent(content, file, symbols = []) {
  const structuralChunks = chunkContentBySymbols(content, file, symbols);
  if (structuralChunks.length) {
    return structuralChunks;
  }
  return chunkContentByLines(content, file);
}

function chunkContentByLines(content, file, baseMetadata = {}) {
  const lines = content.split(/\r?\n/);
  const chunks = [];
  let index = 0;

  for (let start = 0; start < lines.length; start += chunkLineSize - chunkLineOverlap) {
    const end = Math.min(lines.length, start + chunkLineSize);
    const chunkLines = lines.slice(start, end);
    const chunkText = chunkLines.join("\n").trim();
    if (chunkText) {
      chunks.push({
        index,
        startLine: start + 1,
        endLine: end,
        content: chunkText,
        file,
        metadata: {
          chunk_type: "line_window",
          ...baseMetadata
        }
      });
      index += 1;
    }
    if (end === lines.length) {
      break;
    }
  }

  return chunks;
}

function chunkContentBySymbols(content, file, symbols) {
  const lines = content.split(/\r?\n/);
  const chunkableSymbols = symbols
    .filter((symbol) => symbol.filePath === file.relativePath)
    .filter((symbol) => ["class", "interface", "type", "enum", "function", "method", "constructor", "property", "struct", "record", "protocol", "actor", "extension", "mixin", "table", "view", "procedure", "trigger", "message", "service", "rpc", "oneof"].includes(symbol.type))
    .filter((symbol) => Number(symbol.line || 0) > 0)
    .map((symbol) => ({
      ...symbol,
      endLine: Math.min(lines.length, Math.max(Number(symbol.endLine || symbol.line || 1), Number(symbol.line || 1)))
    }))
    .sort((a, b) => a.line - b.line || b.endLine - a.endLine);

  if (!chunkableSymbols.length) {
    return [];
  }

  const chunks = [];
  let index = 0;
  const seenRanges = new Set();
  const firstSymbolLine = chunkableSymbols[0]?.line || 1;
  if (firstSymbolLine > 1) {
    const preamble = lines.slice(0, firstSymbolLine - 1).join("\n").trim();
    if (preamble) {
      chunks.push({
        index,
        startLine: 1,
        endLine: firstSymbolLine - 1,
        content: preamble,
        file,
        metadata: { chunk_type: "file_preamble" }
      });
      index += 1;
    }
  }
  for (let symbolIndex = 0; symbolIndex < chunkableSymbols.length; symbolIndex += 1) {
    const symbol = chunkableSymbols[symbolIndex];
    const rangeKey = `${symbol.line}:${symbol.endLine}:${symbol.name}`;
    if (seenRanges.has(rangeKey)) {
      continue;
    }
    seenRanges.add(rangeKey);

    const parentService = chunkableSymbols.find((candidate) => candidate.type === "service" && candidate.line < symbol.line && candidate.endLine >= symbol.endLine);
    if (symbol.type === "rpc" && parentService) {
      continue;
    }

    const segmentLines = lines.slice(symbol.line - 1, symbol.endLine);
    const maxSymbolLines = Math.max(chunkLineSize, Math.floor(chunkLineSize * 1.5));
    if (segmentLines.length > maxSymbolLines) {
      for (const chunk of chunkContentByLines(segmentLines.join("\n"), file, symbolChunkMetadata(symbol))) {
        chunks.push({
          ...chunk,
          index,
          startLine: symbol.line + chunk.startLine - 1,
          endLine: symbol.line + chunk.endLine - 1
        });
        index += 1;
      }
      continue;
    }

    const contentText = segmentLines.join("\n").trim();
    if (!contentText) {
      continue;
    }
    chunks.push({
      index,
      startLine: symbol.line,
      endLine: symbol.endLine,
      content: contentText,
      file,
      metadata: symbolChunkMetadata(symbol)
    });
    index += 1;
  }

  return chunks;
}

function symbolChunkMetadata(symbol) {
  return {
    chunk_type: "symbol",
    symbol_name: symbol.name,
    symbol_full_name: symbol.fullName,
    symbol_type: symbol.type,
    parent_name: symbol.parentName || null,
    parent_full_name: symbol.parentFullName || null
  };
}

async function analyzeCodeFile(content, file, signal) {
  if (file.language === "csharp" && roslynIndexerUrl) {
    try {
      const analysis = await analyzeCsharpWithRoslyn(content, file, signal);
      analysis.relationships = [
        ...(analysis.relationships || []),
        ...extractPackageManifestRelationships(content, file, analysis.symbols || [])
      ];
      return normalizeAnalysis(analysis, content);
    } catch (error) {
      console.warn("roslyn indexer unavailable, falling back to local csharp analyzer", error);
    }
  }

  const analyzer = languageAnalyzers[file.language] || analyzeGenericTree;
  const analysis = analyzer(content, file);
  analysis.relationships = [
    ...(analysis.relationships || []),
    ...extractPackageManifestRelationships(content, file, analysis.symbols || [])
  ];
  return normalizeAnalysis(analysis, content);
}

function normalizeAnalysis(analysis, content = "") {
  const symbols = enrichSymbolHierarchy(inferSymbolRanges(content, dedupeSymbols(analysis.symbols || [])));
  return {
    symbols,
    relationships: dedupeRelationships(analysis.relationships || [])
  };
}

async function analyzeCsharpWithRoslyn(content, file, signal) {
  const response = await fetch(`${roslynIndexerUrl.replace(/\/$/, "")}/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      file_path: file.relativePath,
      language: file.language,
      content
    }),
    signal: abortSignalWithTimeout(signal, roslynTimeoutMs)
  });

  if (!response.ok) {
    throw new Error(`roslyn_indexer_failed_${response.status}`);
  }

  const body = await response.json();
  return {
    symbols: (body.symbols || []).map((symbol) => createSymbol(file, symbol.type, symbol.name, symbol.line || 1, {
      indexer: "roslyn",
      full_name: symbol.full_name,
      end_line: symbol.end_line,
      parent_name: symbol.parent_name,
      parent_full_name: symbol.parent_full_name,
      ...(symbol.metadata || {})
    })),
    relationships: (body.relationships || []).map((relationship) => createRelationship(file, relationship.type, relationship.target_name, relationship.line || 1, {
      indexer: "roslyn",
      roslyn_kind: relationship.kind,
      ...(relationship.metadata || {})
    }))
  };
}

function analyzePatternLanguage(content, file, symbolPatterns, relationshipExtractors = []) {
  const lines = content.split(/\r?\n/);
  const symbols = [];
  const relationships = [];

  lines.forEach((line, index) => {
    for (const pattern of symbolPatterns) {
      const match = line.match(pattern.regex);
      if (match?.[pattern.group]) {
        const name = match[pattern.group];
        if (ignoredSymbolNames.has(name)) {
          continue;
        }
        symbols.push(createSymbol(file, pattern.type, name, index + 1, pattern.metadata || {}));
      }
    }
  });

  const rangedSymbols = inferSymbolRanges(content, symbols);
  for (const extractor of relationshipExtractors) {
    relationships.push(...extractor(content, file, rangedSymbols));
  }

  return { symbols: rangedSymbols, relationships };
}

function createSymbol(file, type, name, line, metadata = {}) {
  const fullName = metadata.full_name || metadata.fullName || `${file.relativePath}#${name}`;
  const parentName = metadata.parent_name || metadata.parentName || null;
  const parentFullName = metadata.parent_full_name || metadata.parentFullName || null;
  const endLine = Number(metadata.end_line || metadata.endLine || line || 1);
  return {
    type,
    name,
    fullName,
    language: file.language,
    filePath: file.relativePath,
    line,
    endLine,
    parentName,
    parentFullName,
    metadata: {
      indexer: indexerKindForLanguage(file.language),
      ...metadata
    }
  };
}

function createRelationship(file, type, targetName, line, metadata = {}, symbols = []) {
  return {
    type,
    sourceName: relationshipSourceFor(symbols, line),
    targetName,
    sourceFilePath: file.relativePath,
    targetFilePath: metadata.targetFilePath || null,
    language: file.language,
    line,
    metadata: {
      indexer: indexerKindForLanguage(file.language),
      ...metadata
    }
  };
}

function relationshipSourceFor(symbols, line) {
  let current = null;
  for (const symbol of symbols) {
    const startsBefore = Number(symbol.line || 0) <= line;
    const endsAfter = !symbol.endLine || Number(symbol.endLine) >= line;
    if (startsBefore && endsAfter && (!current || symbol.line > current.line)) {
      current = symbol;
    }
  }
  return current?.name || null;
}

function dedupeSymbols(symbols) {
  const seen = new Set();
  return symbols.filter((symbol) => {
    const key = `${symbol.type}:${symbol.name}:${symbol.filePath}:${symbol.line}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dedupeRelationships(relationships) {
  const seen = new Set();
  return relationships.filter((relationship) => {
    const key = `${relationship.type}:${relationship.sourceName || ""}:${relationship.targetName}:${relationship.sourceFilePath}:${relationship.line}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function inferSymbolRanges(content, symbols) {
  if (!content || !symbols.length) {
    return symbols;
  }

  const lines = content.split(/\r?\n/);
  const braceLanguages = new Set(["csharp", "javascript", "typescript", "swift", "dart", "css", "protobuf"]);
  return symbols.map((symbol) => {
    if (symbol.endLine && symbol.endLine > symbol.line) {
      return symbol;
    }

    let endLine = symbol.line;
    if (braceLanguages.has(symbol.language)) {
      endLine = inferBraceRange(lines, symbol.line);
    } else if (["json", "yaml", "sql", "html"].includes(symbol.language)) {
      endLine = inferIndentRange(lines, symbol.line);
    }

    return { ...symbol, endLine: Math.max(symbol.line, endLine) };
  });
}

function inferBraceRange(lines, startLine) {
  let depth = 0;
  let foundOpeningBrace = false;

  for (let lineIndex = Math.max(0, startLine - 1); lineIndex < lines.length; lineIndex += 1) {
    const stripped = stripStringLiterals(lines[lineIndex]);
    for (const char of stripped) {
      if (char === "{") {
        depth += 1;
        foundOpeningBrace = true;
      } else if (char === "}" && foundOpeningBrace) {
        depth -= 1;
        if (depth <= 0) {
          return lineIndex + 1;
        }
      }
    }
    if (!foundOpeningBrace && lineIndex - startLine > 4) {
      break;
    }
  }

  return startLine;
}

function inferIndentRange(lines, startLine) {
  const startIndex = Math.max(0, startLine - 1);
  const startIndent = leadingWhitespace(lines[startIndex] || "");
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }
    if (leadingWhitespace(line) <= startIndent) {
      return Math.max(startLine, index);
    }
  }
  return lines.length;
}

function enrichSymbolHierarchy(symbols) {
  const containerTypes = new Set(["namespace", "class", "interface", "record", "struct", "enum", "protocol", "actor", "extension", "mixin", "type", "message", "service", "oneof", "package"]);
  const byFile = new Map();
  for (const symbol of symbols) {
    const items = byFile.get(symbol.filePath) || [];
    items.push(symbol);
    byFile.set(symbol.filePath, items);
  }

  const enriched = [];
  for (const fileSymbols of byFile.values()) {
    const sorted = fileSymbols.sort((a, b) => a.line - b.line || (b.endLine || b.line) - (a.endLine || a.line));
    for (const symbol of sorted) {
      const parent = sorted
        .filter((candidate) => candidate !== symbol)
        .filter((candidate) => containerTypes.has(candidate.type))
        .filter((candidate) => candidate.line <= symbol.line && Number(candidate.endLine || candidate.line) >= Number(symbol.endLine || symbol.line))
        .sort((a, b) => b.line - a.line || (a.endLine || a.line) - (b.endLine || b.line))[0];
      enriched.push({
        ...symbol,
        parentName: symbol.parentName || parent?.name || null,
        parentFullName: symbol.parentFullName || parent?.fullName || null
      });
    }
  }

  return enriched;
}

function stripStringLiterals(value) {
  return String(value || "").replace(/(["'`]).*?\1/g, "");
}

function leadingWhitespace(value) {
  return String(value || "").match(/^\s*/)?.[0].length || 0;
}

function indexerKindForLanguage(language) {
  if (language === "csharp") {
    return "roslyn-fallback";
  }
  if (["javascript", "typescript", "html", "css", "swift", "dart", "json", "yaml", "sql", "protobuf"].includes(language)) {
    return `${language}-language-indexer`;
  }
  return "generic-tree-indexer";
}

const languageAnalyzers = {
  csharp: analyzeCsharp,
  javascript: analyzeJavaScriptLike,
  typescript: analyzeJavaScriptLike,
  html: analyzeHtml,
  css: analyzeCss,
  swift: analyzeSwift,
  dart: analyzeDart,
  json: analyzeJson,
  yaml: analyzeYaml,
  sql: analyzeSql,
  protobuf: analyzeProtobuf
};

const ignoredSymbolNames = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "throw",
  "else",
  "do",
  "try",
  "finally",
  "guard"
]);

const protobufScalarTypes = new Set([
  "double",
  "float",
  "int32",
  "int64",
  "uint32",
  "uint64",
  "sint32",
  "sint64",
  "fixed32",
  "fixed64",
  "sfixed32",
  "sfixed64",
  "bool",
  "string",
  "bytes"
]);

function analyzeCsharp(content, file) {
  return analyzePatternLanguage(content, file, csharpSymbolPatterns(), [
    extractCsharpRelationships,
    extractCallRelationships
  ]);
}

function analyzeJavaScriptLike(content, file) {
  const commonJs = [
    { type: "class", group: 1, regex: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/ },
    { type: "interface", group: 1, regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
    { type: "type", group: 1, regex: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/ },
    { type: "enum", group: 1, regex: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/ },
    { type: "function", group: 1, regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
    { type: "function", group: 1, regex: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?/ },
    { type: "method", group: 1, regex: /^\s*(?:public|private|protected|static|async|get|set|\s)*\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[{:]/ }
  ];
  return analyzePatternLanguage(content, file, commonJs, [
    extractJavaScriptRelationships,
    extractCallRelationships
  ]);
}

function analyzeSwift(content, file) {
  return analyzePatternLanguage(content, file, [
    { type: "class", group: 1, regex: /^\s*(?:open|public|internal|fileprivate|private)?\s*(?:final\s+)?class\s+([A-Za-z_]\w*)/ },
    { type: "struct", group: 1, regex: /^\s*(?:public|internal|fileprivate|private)?\s*struct\s+([A-Za-z_]\w*)/ },
    { type: "enum", group: 1, regex: /^\s*(?:public|internal|fileprivate|private)?\s*enum\s+([A-Za-z_]\w*)/ },
    { type: "protocol", group: 1, regex: /^\s*(?:public|internal|fileprivate|private)?\s*protocol\s+([A-Za-z_]\w*)/ },
    { type: "actor", group: 1, regex: /^\s*(?:public|internal|fileprivate|private)?\s*actor\s+([A-Za-z_]\w*)/ },
    { type: "function", group: 1, regex: /^\s*(?:open|public|internal|fileprivate|private)?\s*(?:static\s+)?func\s+([A-Za-z_]\w*)\s*\(/ }
  ], [
    extractSwiftRelationships,
    extractCallRelationships
  ]);
}

function analyzeDart(content, file) {
  return analyzePatternLanguage(content, file, [
    { type: "class", group: 1, regex: /^\s*(?:abstract\s+)?class\s+([A-Za-z_]\w*)/ },
    { type: "mixin", group: 1, regex: /^\s*mixin\s+([A-Za-z_]\w*)/ },
    { type: "enum", group: 1, regex: /^\s*enum\s+([A-Za-z_]\w*)/ },
    { type: "extension", group: 1, regex: /^\s*extension\s+([A-Za-z_]\w*)/ },
    { type: "function", group: 1, regex: /^\s*(?:Future<[^>]+>|[\w<>?]+)\s+([A-Za-z_]\w*)\s*\(/ }
  ], [
    extractDartRelationships,
    extractCallRelationships
  ]);
}

function analyzeHtml(content, file) {
  const lines = content.split(/\r?\n/);
  const symbols = [];
  const relationships = [];
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/<([a-zA-Z][\w:-]*)([^>]*)>/g)) {
      const tag = match[1].toLowerCase();
      const attrs = match[2] || "";
      const id = attrs.match(/\bid=["']([^"']+)["']/)?.[1];
      if (id) {
        symbols.push(createSymbol(file, "html_id", `${tag}#${id}`, index + 1, { tag }));
      }
      const classAttr = attrs.match(/\bclass=["']([^"']+)["']/)?.[1];
      for (const className of (classAttr || "").split(/\s+/).filter(Boolean)) {
        symbols.push(createSymbol(file, "html_class", `${tag}.${className}`, index + 1, { tag }));
      }
      for (const attrMatch of attrs.matchAll(/\b(?:src|href|action)=["']([^"']+)["']/g)) {
        relationships.push(createRelationship(file, "REFERENCES", attrMatch[1], index + 1, { attribute: attrMatch[0].split("=")[0] }, symbols));
      }
    }
  });
  return { symbols, relationships };
}

function analyzeCss(content, file) {
  const lines = content.split(/\r?\n/);
  const symbols = [];
  const relationships = [];
  lines.forEach((line, index) => {
    const importMatch = line.match(/@import\s+(?:url\()?["']?([^"')]+)["']?\)?/);
    if (importMatch) {
      relationships.push(createRelationship(file, "IMPORTS", importMatch[1], index + 1, { syntax: "@import" }, symbols));
    }
    for (const urlMatch of line.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      relationships.push(createRelationship(file, "REFERENCES", urlMatch[1], index + 1, { syntax: "url" }, symbols));
    }
    const selectorMatch = line.match(/^\s*([^@{}][^{]+)\{/);
    if (selectorMatch) {
      for (const selector of selectorMatch[1].split(",").map((item) => item.trim()).filter(Boolean)) {
        const normalized = selector.replace(/\s+/g, " ");
        symbols.push(createSymbol(file, selector.startsWith(".") ? "css_class" : selector.startsWith("#") ? "css_id" : "css_selector", normalized, index + 1));
      }
    }
  });
  return { symbols, relationships };
}

function analyzeJson(content, file) {
  const symbols = [];
  const relationships = [];
  try {
    const parsed = JSON.parse(content);
    collectJsonSymbols(parsed, file, symbols);
    if (path.basename(file.relativePath) === "package.json") {
      for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        for (const dependency of Object.keys(parsed[section] || {})) {
          relationships.push(createRelationship(file, "DEPENDS_ON", dependency, 1, { section }, symbols));
        }
      }
    }
  } catch {
    return analyzeGenericTree(content, file);
  }
  return { symbols, relationships };
}

function analyzeYaml(content, file) {
  const lines = content.split(/\r?\n/);
  const symbols = [];
  const relationships = [];
  const stack = [];
  lines.forEach((line, index) => {
    const match = line.match(/^(\s*)([A-Za-z0-9_.-]+):(?:\s*(.*))?$/);
    if (!match) {
      return;
    }
    const indent = match[1].length;
    const key = match[2];
    while (stack.length && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const pathParts = [...stack.map((item) => item.key), key];
    const fullName = pathParts.join(".");
    symbols.push(createSymbol(file, "yaml_key", fullName, index + 1));
    if (["dependencies", "dev_dependencies"].includes(stack.at(-1)?.key) && indent > stack.at(-1).indent) {
      relationships.push(createRelationship(file, "DEPENDS_ON", key, index + 1, { section: stack.at(-1).key }, symbols));
    }
    stack.push({ indent, key });
  });
  return { symbols, relationships };
}

function analyzeSql(content, file) {
  const lines = content.split(/\r?\n/);
  const symbols = [];
  const relationships = [];
  const createPattern = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(TABLE|VIEW|INDEX|FUNCTION|PROCEDURE|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?([\w.]+)["`\]]?/i;
  lines.forEach((line, index) => {
    const createMatch = line.match(createPattern);
    if (createMatch) {
      symbols.push(createSymbol(file, createMatch[1].toLowerCase(), createMatch[2], index + 1));
    }
    for (const match of line.matchAll(/\b(?:FROM|JOIN|REFERENCES|INTO|UPDATE|TABLE)\s+["`[]?([\w.]+)["`\]]?/gi)) {
      relationships.push(createRelationship(file, "REFERENCES", match[1], index + 1, { sql_keyword: match[0].split(/\s+/)[0].toUpperCase() }, symbols));
    }
  });
  return { symbols, relationships };
}

function analyzeProtobuf(content, file) {
  const lines = content.split(/\r?\n/);
  const symbols = [];
  const relationships = [];
  const stack = [];
  let packageName = "";
  let braceDepth = 0;

  lines.forEach((rawLine, index) => {
    while (stack.length && braceDepth <= stack.at(-1).closeDepth) {
      stack.pop();
    }

    const line = stripProtobufLineComment(rawLine);
    const trimmed = line.trim();
    const lineNumber = index + 1;
    if (!trimmed) {
      return;
    }

    const packageMatch = trimmed.match(/^package\s+([A-Za-z_][\w.]*)\s*;/);
    if (packageMatch) {
      packageName = packageMatch[1];
      symbols.push(createSymbol(file, "package", packageName, lineNumber, {
        full_name: packageName,
        proto_kind: "package"
      }));
    }

    const importMatch = trimmed.match(/^import\s+(?:(?:public|weak)\s+)?["']([^"']+\.proto)["']\s*;/);
    if (importMatch) {
      relationships.push(createRelationship(file, "IMPORTS", importMatch[1], lineNumber, {
        syntax: "proto-import",
        targetFilePath: importMatch[1]
      }, symbols));
    }

    const containerMatch = trimmed.match(/^(message|service|enum|oneof)\s+([A-Za-z_]\w*)\b/);
    if (containerMatch) {
      const type = containerMatch[1];
      const name = containerMatch[2];
      const fullName = protobufFullName(packageName, stack, name);
      symbols.push(createSymbol(file, type, name, lineNumber, {
        full_name: fullName,
        proto_kind: type,
        parent_name: stack.at(-1)?.name || null,
        parent_full_name: stack.at(-1)?.fullName || null
      }));
      if (trimmed.includes("{")) {
        stack.push({ type, name, fullName, closeDepth: braceDepth });
      }
    }

    const rpcMatch = trimmed.match(/^rpc\s+([A-Za-z_]\w*)\s*\(\s*(?:stream\s+)?([.\w]+)\s*\)\s+returns\s*\(\s*(?:stream\s+)?([.\w]+)\s*\)/);
    if (rpcMatch) {
      const name = rpcMatch[1];
      const requestType = normalizeProtoTypeName(rpcMatch[2]);
      const responseType = normalizeProtoTypeName(rpcMatch[3]);
      const fullName = protobufFullName(packageName, stack, name);
      symbols.push(createSymbol(file, "rpc", name, lineNumber, {
        full_name: fullName,
        proto_kind: "rpc",
        parent_name: stack.at(-1)?.name || null,
        parent_full_name: stack.at(-1)?.fullName || null,
        request_type: requestType,
        response_type: responseType
      }));
      for (const [role, target] of [["request", requestType], ["response", responseType]]) {
        if (target) {
          relationships.push(createRelationship(file, "REFERENCES", target, lineNumber, {
            syntax: "rpc-type",
            role,
            rpc: name
          }, symbols));
        }
      }
    }

    const field = protobufField(trimmed);
    if (field) {
      for (const target of field.types) {
        if (!protobufScalarTypes.has(target)) {
          relationships.push(createRelationship(file, "REFERENCES", target, lineNumber, {
            syntax: "field-type",
            field: field.name
          }, symbols));
        }
      }
    }

    const braceLine = stripStringLiterals(line);
    braceDepth += (braceLine.match(/{/g) || []).length;
    braceDepth -= (braceLine.match(/}/g) || []).length;
    while (stack.length && braceDepth <= stack.at(-1).closeDepth) {
      stack.pop();
    }
  });

  return { symbols, relationships };
}

function protobufFullName(packageName, stack, name) {
  return [...(packageName ? [packageName] : []), ...stack.map((item) => item.name), name].join(".");
}

function stripProtobufLineComment(line) {
  return String(line || "").replace(/\/\/.*$/, "");
}

function normalizeProtoTypeName(value) {
  return String(value || "").trim().replace(/^stream\s+/, "").replace(/^\./, "");
}

function protobufField(line) {
  if (/^(reserved|option|extensions|extend|rpc|message|service|enum|oneof|package|import)\b/.test(line)) {
    return null;
  }

  const mapMatch = line.match(/^(?:optional|required|repeated)?\s*map\s*<\s*([.\w]+)\s*,\s*([.\w]+)\s*>\s+([A-Za-z_]\w*)\s*=\s*\d+/);
  if (mapMatch) {
    return {
      name: mapMatch[3],
      types: [normalizeProtoTypeName(mapMatch[1]), normalizeProtoTypeName(mapMatch[2])].filter(Boolean)
    };
  }

  const fieldMatch = line.match(/^(?:optional|required|repeated)?\s*([.\w]+)\s+([A-Za-z_]\w*)\s*=\s*\d+/);
  if (!fieldMatch) {
    return null;
  }

  return {
    name: fieldMatch[2],
    types: [normalizeProtoTypeName(fieldMatch[1])].filter(Boolean)
  };
}

function analyzeGenericTree(content, file) {
  const lines = content.split(/\r?\n/);
  const symbols = [];
  lines.forEach((line, index) => {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+)/);
    if (heading) {
      symbols.push(createSymbol(file, "heading", heading[1].trim().slice(0, 160), index + 1));
    }
    const key = line.match(/^\s*([A-Za-z0-9_.-]{2,80})\s*[:=]/);
    if (key) {
      symbols.push(createSymbol(file, "key", key[1], index + 1));
    }
  });
  return { symbols, relationships: [] };
}

function csharpSymbolPatterns() {
  return [
    { type: "namespace", group: 1, regex: /^\s*namespace\s+([A-Za-z_][\w.]*)/ },
    { type: "class", group: 1, regex: /^\s*(?:public|private|internal|protected)?\s*(?:sealed|abstract|static|partial)?\s*class\s+([A-Za-z_]\w*)/ },
    { type: "interface", group: 1, regex: /^\s*(?:public|private|internal)?\s*(?:partial)?\s*interface\s+([A-Za-z_]\w*)/ },
    { type: "record", group: 1, regex: /^\s*(?:public|private|internal)?\s*(?:partial)?\s*record\s+([A-Za-z_]\w*)/ },
    { type: "struct", group: 1, regex: /^\s*(?:public|private|internal)?\s*(?:readonly|partial)?\s*struct\s+([A-Za-z_]\w*)/ },
    { type: "enum", group: 1, regex: /^\s*(?:public|private|internal)?\s*enum\s+([A-Za-z_]\w*)/ },
    { type: "method", group: 1, regex: /^\s*(?:public|private|internal|protected)?\s*(?:static\s+)?(?:async\s+)?[\w<>\[\],?]+\s+([A-Za-z_]\w*)\s*\(/ }
  ];
}

function extractCsharpRelationships(content, file, symbols) {
  const relationships = [];
  content.split(/\r?\n/).forEach((line, index) => {
    const usingMatch = line.match(/^\s*using\s+(?:static\s+)?([A-Za-z_][\w.]*)\s*;/);
    if (usingMatch) {
      relationships.push(createRelationship(file, "IMPORTS", usingMatch[1], index + 1, { syntax: "using" }, symbols));
    }
    const inheritsMatch = line.match(/\b(?:class|interface|record|struct)\s+([A-Za-z_]\w*)\s*:\s*([^{]+)/);
    if (inheritsMatch) {
      for (const target of inheritsMatch[2].split(",").map((item) => item.trim().split(/\s+/).pop()).filter(Boolean)) {
        relationships.push(createRelationship(file, "REFERENCES", target, index + 1, { syntax: "inheritance", source: inheritsMatch[1] }, symbols));
      }
    }
  });
  return relationships;
}

function extractJavaScriptRelationships(content, file, symbols) {
  const relationships = [];
  content.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(/\bimport\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g)) {
      relationships.push(createRelationship(file, "IMPORTS", match[1], index + 1, { syntax: "import" }, symbols));
    }
    for (const match of line.matchAll(/\bexport\s+[^'"]+\s+from\s+["']([^"']+)["']/g)) {
      relationships.push(createRelationship(file, "IMPORTS", match[1], index + 1, { syntax: "export-from" }, symbols));
    }
    for (const match of line.matchAll(/\brequire\(["']([^"']+)["']\)/g)) {
      relationships.push(createRelationship(file, "IMPORTS", match[1], index + 1, { syntax: "require" }, symbols));
    }
  });
  return relationships;
}

function extractSwiftRelationships(content, file, symbols) {
  const relationships = [];
  content.split(/\r?\n/).forEach((line, index) => {
    const importMatch = line.match(/^\s*import\s+([A-Za-z_]\w*)/);
    if (importMatch) {
      relationships.push(createRelationship(file, "IMPORTS", importMatch[1], index + 1, { syntax: "import" }, symbols));
    }
    const conformsMatch = line.match(/\b(?:class|struct|enum|actor)\s+([A-Za-z_]\w*)\s*:\s*([^{]+)/);
    if (conformsMatch) {
      for (const target of conformsMatch[2].split(",").map((item) => item.trim().split(/\s+/)[0]).filter(Boolean)) {
        relationships.push(createRelationship(file, "REFERENCES", target, index + 1, { syntax: "conformance", source: conformsMatch[1] }, symbols));
      }
    }
  });
  return relationships;
}

function extractDartRelationships(content, file, symbols) {
  const relationships = [];
  content.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(/^\s*(?:import|export|part)\s+['"]([^'"]+)['"]/g)) {
      relationships.push(createRelationship(file, "IMPORTS", match[1], index + 1, { syntax: line.trim().split(/\s+/)[0] }, symbols));
    }
    const extendsMatch = line.match(/\bclass\s+([A-Za-z_]\w*)\s+(?:extends|with|implements)\s+([^{]+)/);
    if (extendsMatch) {
      for (const target of extendsMatch[2].split(",").map((item) => item.trim().split(/\s+/)[0]).filter(Boolean)) {
        relationships.push(createRelationship(file, "REFERENCES", target, index + 1, { syntax: "type-reference", source: extendsMatch[1] }, symbols));
      }
    }
  });
  return relationships;
}

function extractPackageManifestRelationships(content, file, symbols = []) {
  const baseName = path.basename(file.relativePath).toLowerCase();
  const relationships = [];

  if (["package.json", "package-lock.json"].includes(baseName)) {
    try {
      const parsed = JSON.parse(content);
      const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
      const packages = baseName === "package-lock.json" && parsed.packages ? parsed.packages[""] || {} : parsed;
      for (const section of sections) {
        for (const dependency of Object.keys(packages[section] || {})) {
          relationships.push(createRelationship(file, "DEPENDS_ON", dependency, 1, { manifest: baseName, section }, symbols));
        }
      }
    } catch {
      // Keep normal file indexing even when a lockfile is partially written.
    }
  }

  if (["pubspec.yaml", "pubspec.yml"].includes(baseName)) {
    relationships.push(...extractYamlDependencySections(content, file, symbols, ["dependencies", "dev_dependencies", "dependency_overrides"], baseName));
  }

  if (["pnpm-lock.yaml", "pnpm-lock.yml", "yarn.lock", "pubspec.lock"].includes(baseName)) {
    relationships.push(...extractLockfileDependencyNames(content, file, symbols, baseName));
  }

  if (["packages.config", "directory.packages.props"].includes(baseName) || file.relativePath.toLowerCase().endsWith(".csproj")) {
    for (const match of content.matchAll(/<PackageReference\b[^>]*\bInclude=["']([^"']+)["'][^>]*>/gi)) {
      relationships.push(createRelationship(file, "DEPENDS_ON", match[1], lineForOffset(content, match.index || 0), { manifest: baseName || "csproj", syntax: "PackageReference" }, symbols));
    }
    for (const match of content.matchAll(/<package\b[^>]*\bid=["']([^"']+)["'][^>]*>/gi)) {
      relationships.push(createRelationship(file, "DEPENDS_ON", match[1], lineForOffset(content, match.index || 0), { manifest: baseName, syntax: "packages.config" }, symbols));
    }
  }

  if (baseName === "package.swift") {
    for (const match of content.matchAll(/\.package\s*\([^)]*?(?:url|path):\s*"([^"]+)"/gs)) {
      relationships.push(createRelationship(file, "DEPENDS_ON", normalizeDependencyName(match[1]), lineForOffset(content, match.index || 0), { manifest: baseName, syntax: "swift-package" }, symbols));
    }
  }

  if (baseName === "podfile") {
    for (const match of content.matchAll(/^\s*pod\s+['"]([^'"]+)['"]/gim)) {
      relationships.push(createRelationship(file, "DEPENDS_ON", match[1], lineForOffset(content, match.index || 0), { manifest: baseName, syntax: "cocoapods" }, symbols));
    }
  }

  return relationships;
}

function extractYamlDependencySections(content, file, symbols, sections, manifest) {
  const relationships = [];
  const lines = content.split(/\r?\n/);
  let currentSection = null;
  let sectionIndent = 0;
  lines.forEach((line, index) => {
    const sectionMatch = line.match(/^(\s*)([A-Za-z_][\w-]*):\s*$/);
    if (sectionMatch && sections.includes(sectionMatch[2])) {
      currentSection = sectionMatch[2];
      sectionIndent = sectionMatch[1].length;
      return;
    }
    if (!currentSection) {
      return;
    }
    if (line.trim() && leadingWhitespace(line) <= sectionIndent) {
      currentSection = null;
      return;
    }
    const dependencyMatch = line.match(/^\s{2,}([A-Za-z0-9_.-]+):/);
    if (dependencyMatch) {
      relationships.push(createRelationship(file, "DEPENDS_ON", dependencyMatch[1], index + 1, { manifest, section: currentSection }, symbols));
    }
  });
  return relationships;
}

function extractLockfileDependencyNames(content, file, symbols, manifest) {
  const relationships = [];
  content.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^\s{0,4}(?:["']?\/?([@A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?)@|([A-Za-z0-9_.-]+):)/);
    const dependency = match?.[1] || match?.[2];
    if (dependency && !["packages", "dependencies", "dev_dependencies", "sdks"].includes(dependency)) {
      relationships.push(createRelationship(file, "DEPENDS_ON", dependency, index + 1, { manifest, syntax: "lockfile" }, symbols));
    }
  });
  return relationships;
}

function normalizeDependencyName(value) {
  const text = String(value || "").replace(/\.git$/, "");
  return text.split(/[/:]/).filter(Boolean).pop() || text;
}

function lineForOffset(content, offset) {
  return content.slice(0, offset).split(/\r?\n/).length;
}

function extractCallRelationships(content, file, symbols) {
  const keywords = new Set([
    "if", "for", "while", "switch", "catch", "return", "throw", "new", "typeof",
    "sizeof", "nameof", "await", "guard", "let", "var", "func", "function", "class",
    "struct", "enum", "protocol", "interface", "record", "using", "import"
  ]);
  const relationships = [];
  content.split(/\r?\n/).forEach((line, index) => {
    const stripped = line.replace(/(["'`]).*?\1/g, "");
    for (const match of stripped.matchAll(/\b([A-Za-z_][$\w]*(?:\.[A-Za-z_][$\w]*)?)\s*\(/g)) {
      const target = match[1];
      const root = target.split(".")[0];
      if (!keywords.has(root) && !keywords.has(target)) {
        relationships.push(createRelationship(file, "CALLS", target, index + 1, { syntax: "call-expression" }, symbols));
      }
    }
  });
  return relationships;
}

function collectJsonSymbols(value, file, symbols, prefix = "", depth = 0) {
  if (!value || typeof value !== "object" || depth > 4) {
    return;
  }
  if (Array.isArray(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const fullName = prefix ? `${prefix}.${key}` : key;
    symbols.push(createSymbol(file, "json_key", fullName, 1));
    collectJsonSymbols(child, file, symbols, fullName, depth + 1);
  }
}

function buildChunkEmbeddingText(chunk) {
  return [
    `Repository file: ${chunk.file.relativePath}`,
    `Language: ${chunk.file.language}`,
    `Lines: ${chunk.startLine}-${chunk.endLine}`,
    chunk.metadata?.symbol_full_name ? `Symbol: ${chunk.metadata.symbol_full_name}` : null,
    chunk.metadata?.parent_full_name ? `Parent: ${chunk.metadata.parent_full_name}` : null,
    chunk.content
  ].filter(Boolean).join("\n");
}

function splitChunksForEmbedding(chunks) {
  const result = [];
  let index = 0;
  for (let parentChunkIndex = 0; parentChunkIndex < chunks.length; parentChunkIndex += 1) {
    const chunk = chunks[parentChunkIndex];
    const lines = chunk.content.split(/\r?\n/);
    const needsSplit = chunk.content.length > embeddingContentMaxChars || lines.length > embeddingContentMaxLines;
    if (!needsSplit) {
      result.push({ ...chunk, index });
      index += 1;
      continue;
    }
    let start = 0;
    let subchunkIndex = 0;
    while (start < lines.length) {
      let end = start;
      let chars = 0;
      while (end < lines.length && end - start < embeddingContentMaxLines) {
        const next = lines[end];
        if (end > start && chars + next.length + 1 > embeddingContentMaxChars) break;
        chars += next.length + 1;
        end += 1;
        if (chars >= embeddingContentMaxChars) break;
      }
      if (end === start) end += 1;
      const content = lines.slice(start, end).join("\n").trim();
      if (content) {
        result.push({
          ...chunk,
          index,
          startLine: chunk.startLine + start,
          endLine: chunk.startLine + end - 1,
          content,
          metadata: {
            ...(chunk.metadata || {}),
            split_reason: "embedding_context_limit",
            parent_chunk_index: parentChunkIndex,
            subchunk_index: subchunkIndex
          }
        });
        index += 1;
        subchunkIndex += 1;
      }
      start = end;
    }
  }
  return result;
}

function isRetryableEmbeddingError(error) {
  const message = String(error?.message || error).toLowerCase();
  return error?.name === "TimeoutError" || error?.name === "AbortError" || message.includes("ollama_embedding_failed_500") || message.includes("timeout");
}

function isContextLimitError(error) {
  const message = String(error?.message || error).toLowerCase();
  return message.includes("input length exceeds the context length") || message.includes("embedding_input_exceeds_configured_limit");
}

function truncateChunkForEmbedding(chunk) {
  const maxContentChars = Math.max(64, embeddingContentMaxChars - 128);
  const content = chunk.content.slice(0, maxContentChars);
  const retainedLines = content.split(/\r?\n/).length;
  return {
    ...chunk,
    content,
    endLine: Math.min(chunk.endLine, chunk.startLine + retainedLines - 1),
    metadata: {
      ...(chunk.metadata || {}),
      truncated: true,
      truncate_reason: "embedding_context_limit"
    }
  };
}

async function createEmbedding(text, signal) {
  if (text.length > embeddingMaxChars || text.split(/\r?\n/).length > embeddingMaxLines) {
    throw new Error("embedding_input_exceeds_configured_limit");
  }
  let lastError;
  for (let attempt = 0; attempt <= embeddingMaxRetries; attempt += 1) {
    try {
      const response = await fetch(`${ollamaUrl}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: embeddingModel, prompt: text }),
        signal: abortSignalWithTimeout(signal, embeddingTimeoutMs)
      });
      if (!response.ok) throw new Error(`ollama_embedding_failed_${response.status}: ${await response.text()}`);
      const body = await response.json();
      if (!Array.isArray(body.embedding)) throw new Error("ollama_embedding_missing_vector");
      return body.embedding;
    } catch (error) {
      lastError = error;
      if (!isRetryableEmbeddingError(error) || attempt === embeddingMaxRetries || signal?.aborted) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function ensureQdrantCollection(collectionName) {
  const current = await fetch(`${qdrantUrl}/collections/${collectionName}`, {
    headers: qdrantHeaders()
  });
  if (current.ok) {
    const body = await current.json();
    const currentSize = body.result?.config?.params?.vectors?.size;
    if (currentSize && Number(currentSize) !== embeddingVectorSize) {
      throw new Error(`qdrant_collection_vector_size_mismatch: ${collectionName} has ${currentSize}, expected ${embeddingVectorSize}`);
    }
    return;
  }

  const response = await fetch(`${qdrantUrl}/collections/${collectionName}`, {
    method: "PUT",
    headers: qdrantHeaders(),
    body: JSON.stringify({
      vectors: {
        size: embeddingVectorSize,
        distance: "Cosine"
      }
    })
  });

  if (!response.ok) {
    throw new Error(`qdrant_collection_failed_${response.status}: ${await response.text()}`);
  }
}

async function upsertQdrantPoint(collectionName, pointId, vector, payload) {
  const response = await fetch(`${qdrantUrl}/collections/${collectionName}/points?wait=true`, {
    method: "PUT",
    headers: qdrantHeaders(),
    body: JSON.stringify({
      points: [
        {
          id: pointId,
          vector,
          payload
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`qdrant_upsert_failed_${response.status}: ${await response.text()}`);
  }
}

async function deleteQdrantRepositoryPoints(repositoryId) {
  const response = await fetch(`${qdrantUrl}/collections/${codeCollection}/points/delete?wait=true`, {
    method: "POST",
    headers: qdrantHeaders(),
    body: JSON.stringify({
      filter: {
        must: [
          { key: "repository_id", match: { value: repositoryId } }
        ]
      }
    })
  });

  if (![200, 404].includes(response.status)) {
    throw new Error(`qdrant_delete_failed_${response.status}: ${await response.text()}`);
  }
}

async function deleteQdrantFilePoints(repositoryId, filePath) {
  const response = await fetch(`${qdrantUrl}/collections/${codeCollection}/points/delete?wait=true`, {
    method: "POST",
    headers: qdrantHeaders(),
    body: JSON.stringify({
      filter: {
        must: [
          { key: "repository_id", match: { value: repositoryId } },
          { key: "file_path", match: { value: filePath } }
        ]
      }
    })
  });

  if (![200, 404].includes(response.status)) {
    throw new Error(`qdrant_file_delete_failed_${response.status}: ${await response.text()}`);
  }
}

function qdrantHeaders() {
  return {
    "content-type": "application/json",
    ...(qdrantApiKey ? { "api-key": qdrantApiKey } : {})
  };
}

async function ensureNeo4jSchema() {
  if (!neo4jPassword) {
    return;
  }

  await runNeo4jStatements([
    { statement: "CREATE CONSTRAINT repo_id IF NOT EXISTS FOR (r:Repository) REQUIRE r.id IS UNIQUE" },
    { statement: "CREATE CONSTRAINT file_key IF NOT EXISTS FOR (f:CodeFile) REQUIRE f.key IS UNIQUE" },
    { statement: "CREATE CONSTRAINT symbol_key IF NOT EXISTS FOR (s:CodeSymbol) REQUIRE s.key IS UNIQUE" },
    { statement: "CREATE CONSTRAINT reference_key IF NOT EXISTS FOR (r:CodeReference) REQUIRE r.key IS UNIQUE" }
  ]);
}

async function upsertNeo4jRepository(workspace, repository, files, symbols, relationships = []) {
  if (!neo4jPassword) {
    return;
  }

  const statements = [
    {
      statement: `
        MERGE (w:Workspace {id: $workspaceId})
        SET w.slug = $workspaceSlug, w.name = $workspaceName
        MERGE (r:Repository {id: $repositoryId})
        SET r.name = $repositoryName, r.url = $repositoryUrl, r.workspace_id = $workspaceId
        MERGE (w)-[:CONTAINS]->(r)
      `,
      parameters: {
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        workspaceName: workspace.name,
        repositoryId: repository.id,
        repositoryName: repository.name,
        repositoryUrl: repository.url
      }
    },
    ...files.map((file) => ({
      statement: `
        MATCH (r:Repository {id: $repositoryId})
        MERGE (f:CodeFile {key: $fileKey})
        SET f.path = $filePath, f.language = $language, f.repository_id = $repositoryId, f.workspace_id = $workspaceId
        MERGE (r)-[:CONTAINS]->(f)
      `,
      parameters: {
        workspaceId: workspace.id,
        repositoryId: repository.id,
        fileKey: `${repository.id}:${file.relativePath}`,
        filePath: file.relativePath,
        language: file.language
      }
    })),
    ...symbols.map((symbol) => ({
      statement: `
        MATCH (f:CodeFile {key: $fileKey})
        MERGE (s:CodeSymbol {key: $symbolKey})
        SET s.name = $name, s.type = $type, s.language = $language, s.file_path = $filePath,
            s.repository_id = $repositoryId, s.workspace_id = $workspaceId, s.line = $line,
            s.end_line = $endLine, s.parent_name = $parentName, s.parent_full_name = $parentFullName
        MERGE (f)-[:DECLARES]->(s)
      `,
      parameters: {
        workspaceId: workspace.id,
        repositoryId: repository.id,
        fileKey: `${repository.id}:${symbol.filePath}`,
        symbolKey: `${repository.id}:${symbol.filePath}:${symbol.name}:${symbol.line}`,
        name: symbol.name,
        type: symbol.type,
        language: symbol.language,
        filePath: symbol.filePath,
        line: symbol.line,
        endLine: symbol.endLine || symbol.line,
        parentName: symbol.parentName || null,
        parentFullName: symbol.parentFullName || null
      }
    })),
    ...symbols.filter((symbol) => symbol.parentName).map((symbol) => ({
      statement: `
        MATCH (child:CodeSymbol {key: $childKey})
        MATCH (parent:CodeSymbol {repository_id: $repositoryId, file_path: $filePath, name: $parentName})
        MERGE (parent)-[:CONTAINS_SYMBOL]->(child)
      `,
      parameters: {
        repositoryId: repository.id,
        childKey: `${repository.id}:${symbol.filePath}:${symbol.name}:${symbol.line}`,
        filePath: symbol.filePath,
        parentName: symbol.parentName
      }
    })),
    ...relationships.map((relationship) => ({
      statement: `
        MATCH (f:CodeFile {key: $fileKey})
        MERGE (ref:CodeReference {key: $referenceKey})
        SET ref.name = $targetName, ref.relationship_type = $relationshipType,
            ref.language = $language, ref.repository_id = $repositoryId,
            ref.workspace_id = $workspaceId, ref.source_file_path = $sourceFilePath,
            ref.line = $line
        MERGE (f)-[:${neo4jRelationshipType(relationship.type)}]->(ref)
      `,
      parameters: {
        workspaceId: workspace.id,
        repositoryId: repository.id,
        fileKey: `${repository.id}:${relationship.sourceFilePath}`,
        referenceKey: `${repository.id}:${relationship.sourceFilePath}:${relationship.type}:${relationship.targetName}:${relationship.line}`,
        targetName: relationship.targetName,
        relationshipType: relationship.type,
        language: relationship.language,
        sourceFilePath: relationship.sourceFilePath,
        line: relationship.line
      }
    })),
    {
      statement: `
        MATCH (w:Workspace {id: $workspaceId})-[:CONTAINS]->(:Repository)-[:CONTAINS]->(:CodeFile)-[:DECLARES]->(a:CodeSymbol)
        MATCH (w)-[:CONTAINS]->(:Repository)-[:CONTAINS]->(:CodeFile)-[:DECLARES]->(b:CodeSymbol)
        WHERE a.repository_id <> b.repository_id
          AND a.name = b.name
          AND elementId(a) < elementId(b)
        MERGE (a)-[:RELATED_SYMBOL {reason: 'same_name_cross_repository'}]->(b)
      `,
      parameters: {
        workspaceId: workspace.id
      }
    }
  ];

  await runNeo4jStatements(statements);
}

async function linkWorkspaceRelatedSymbols(workspaceId) {
  if (!neo4jPassword) {
    return;
  }

  await runNeo4jStatements([
    {
      statement: `
        MATCH (w:Workspace {id: $workspaceId})-[:CONTAINS]->(:Repository)-[:CONTAINS]->(:CodeFile)-[:DECLARES]->(a:CodeSymbol)
        MATCH (w)-[:CONTAINS]->(:Repository)-[:CONTAINS]->(:CodeFile)-[:DECLARES]->(b:CodeSymbol)
        WHERE a.repository_id <> b.repository_id
          AND a.name = b.name
          AND elementId(a) < elementId(b)
        MERGE (a)-[:RELATED_SYMBOL {reason: 'same_name_cross_repository'}]->(b)
      `,
      parameters: {
        workspaceId
      }
    }
  ]);
}

async function syncResolvedRelationshipsToNeo4j(workspaceId) {
  if (!neo4jPassword) {
    return;
  }

  const result = await query(
    `SELECT
       cr.repository_id,
       cr.relationship_type,
       cr.target_name,
       cr.source_file_path,
       cr.start_line,
       cr.resolution_status,
       cr.target_file_path,
       cr.target_repository_id,
       source_symbol.file_path AS source_symbol_file_path,
       source_symbol.name AS source_symbol_name,
       source_symbol.start_line AS source_symbol_line,
       target_symbol.repository_id AS target_symbol_repository_id,
       target_symbol.file_path AS target_symbol_file_path,
       target_symbol.name AS target_symbol_name,
       target_symbol.start_line AS target_symbol_line
     FROM code_relationships cr
     LEFT JOIN code_symbols source_symbol ON source_symbol.id = cr.source_symbol_id
     LEFT JOIN code_symbols target_symbol ON target_symbol.id = cr.target_symbol_id
     WHERE cr.workspace_id = $1
       AND cr.resolution_status <> 'unresolved'`,
    [workspaceId]
  );

  const statements = [
    {
      statement: `
        MATCH (ref:CodeReference {workspace_id: $workspaceId})-[rel:RESOLVES_TO]->()
        DELETE rel
      `,
      parameters: { workspaceId }
    },
    {
      statement: `
        MATCH (:CodeSymbol {workspace_id: $workspaceId})-[rel:EMITS_REFERENCE]->(:CodeReference)
        DELETE rel
      `,
      parameters: { workspaceId }
    }
  ];
  for (const relationship of result.rows) {
    const referenceKey = `${relationship.repository_id}:${relationship.source_file_path}:${relationship.relationship_type}:${relationship.target_name}:${relationship.start_line}`;

    if (relationship.source_symbol_name) {
      statements.push({
        statement: `
          MATCH (source:CodeSymbol {key: $sourceKey})
          MATCH (ref:CodeReference {key: $referenceKey})
          MERGE (source)-[:EMITS_REFERENCE]->(ref)
        `,
        parameters: {
          sourceKey: `${relationship.repository_id}:${relationship.source_symbol_file_path}:${relationship.source_symbol_name}:${relationship.source_symbol_line}`,
          referenceKey
        }
      });
    }

    if (relationship.target_symbol_name) {
      statements.push({
        statement: `
          MATCH (ref:CodeReference {key: $referenceKey})
          MATCH (target:CodeSymbol {key: $targetKey})
          MERGE (ref)-[:RESOLVES_TO {status: $status}]->(target)
        `,
        parameters: {
          referenceKey,
          targetKey: `${relationship.target_symbol_repository_id}:${relationship.target_symbol_file_path}:${relationship.target_symbol_name}:${relationship.target_symbol_line}`,
          status: relationship.resolution_status
        }
      });
      continue;
    }

    if (relationship.target_file_path && relationship.target_repository_id) {
      statements.push({
        statement: `
          MATCH (ref:CodeReference {key: $referenceKey})
          MATCH (target:CodeFile {key: $targetKey})
          MERGE (ref)-[:RESOLVES_TO {status: $status}]->(target)
        `,
        parameters: {
          referenceKey,
          targetKey: `${relationship.target_repository_id}:${relationship.target_file_path}`,
          status: relationship.resolution_status
        }
      });
      continue;
    }

    if (relationship.target_repository_id) {
      statements.push({
        statement: `
          MATCH (ref:CodeReference {key: $referenceKey})
          MATCH (target:Repository {id: $targetRepositoryId})
          MERGE (ref)-[:RESOLVES_TO {status: $status}]->(target)
        `,
        parameters: {
          referenceKey,
          targetRepositoryId: relationship.target_repository_id,
          status: relationship.resolution_status
        }
      });
    }
  }

  if (statements.length) {
    await runNeo4jStatements(statements);
  }
}

async function deleteNeo4jRepository(repositoryId) {
  if (!neo4jPassword) {
    return;
  }

  await runNeo4jStatements([
    {
      statement: `
        MATCH (r:Repository {id: $repositoryId})
        OPTIONAL MATCH (r)-[:CONTAINS]->(f:CodeFile)
        OPTIONAL MATCH (f)-[:DECLARES]->(s:CodeSymbol)
        OPTIONAL MATCH (f)-[:IMPORTS|CALLS|REFERENCES|DEPENDS_ON]->(ref:CodeReference)
        DETACH DELETE s, ref, f, r
      `,
      parameters: { repositoryId }
    }
  ]);
}

async function deleteNeo4jFile(repositoryId, filePath) {
  if (!neo4jPassword) {
    return;
  }

  await runNeo4jStatements([
    {
      statement: `
        MATCH (f:CodeFile {key: $fileKey})
        OPTIONAL MATCH (f)-[:DECLARES]->(s:CodeSymbol)
        OPTIONAL MATCH (f)-[:IMPORTS|CALLS|REFERENCES|DEPENDS_ON]->(ref:CodeReference)
        DETACH DELETE s, ref, f
      `,
      parameters: {
        fileKey: `${repositoryId}:${filePath}`
      }
    }
  ]);
}

function neo4jRelationshipType(type) {
  const allowed = new Set(["IMPORTS", "CALLS", "REFERENCES", "DEPENDS_ON"]);
  const normalized = String(type || "REFERENCES").toUpperCase();
  return allowed.has(normalized) ? normalized : "REFERENCES";
}

async function runNeo4jStatements(statements) {
  const response = await fetch(`${neo4jUrl}/db/neo4j/tx/commit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Basic ${Buffer.from(`neo4j:${neo4jPassword}`).toString("base64")}`
    },
    body: JSON.stringify({ statements }),
    signal: AbortSignal.timeout(neo4jTimeoutMs)
  });

  if (!response.ok) {
    throw new Error(`neo4j_request_failed_${response.status}: ${await response.text()}`);
  }

  const body = await response.json();
  if (body.errors?.length) {
    throw new Error(`neo4j_statement_failed: ${JSON.stringify(body.errors).slice(0, 1000)}`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function addRepository(workspaceIdOrSlug, payload) {
  const workspace = await getWorkspace(workspaceIdOrSlug);
  if (!workspace) {
    const error = new Error("workspace_not_found");
    error.status = 404;
    throw error;
  }

  const provider = String(payload.provider || "github").trim();
  const name = assertSafeSegment(payload.name || inferRepoName(payload.url), "repository_name");
  const url = String(payload.url || "").trim();
  const defaultBranch = String(payload.default_branch || "main").trim();

  if (!url) {
    const error = new Error("repository_url_required");
    error.status = 400;
    throw error;
  }

  const workspacePath = path.join(reposRoot, workspace.slug);
  const targetPath = path.join(workspacePath, name);

  if (!targetPath.startsWith(path.resolve(reposRoot))) {
    const error = new Error("repository_path_invalid");
    error.status = 400;
    throw error;
  }

  if (existsSync(targetPath)) {
    const error = new Error("repository_directory_already_exists");
    error.status = 409;
    throw error;
  }

  await fs.mkdir(workspacePath, { recursive: true });

  const inserted = await query(
    `INSERT INTO repositories (workspace_id, name, provider, url, default_branch, local_path, status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, 'cloning', $7)
     RETURNING id, workspace_id, name, provider, url, default_branch, local_path, status, metadata, created_at, updated_at`,
    [workspace.id, name, provider, url, defaultBranch, targetPath, { source: "admin-ui" }]
  );

  const repository = inserted.rows[0];

  try {
    await runGitClone(url, defaultBranch, targetPath);
  } catch (error) {
    await query(
      `UPDATE repositories
       SET status = 'error', metadata = metadata || $2::jsonb, updated_at = NOW()
       WHERE id = $1`,
      [repository.id, JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 1000) : "clone_failed" })]
    );
    await fs.rm(targetPath, { recursive: true, force: true });
    throw error;
  }

  const updated = await query(
    `UPDATE repositories
     SET status = 'index_queued', updated_at = NOW()
     WHERE id = $1
     RETURNING id, workspace_id, name, provider, url, default_branch, local_path, status, metadata, created_at, updated_at`,
    [repository.id]
  );

  await enqueueRepositoryIndex(workspace, updated.rows[0]);
  return updated.rows[0];
}

async function deleteRepository(workspaceIdOrSlug, repositoryId) {
  const workspace = await getWorkspace(workspaceIdOrSlug);
  if (!workspace) {
    const error = new Error("workspace_not_found");
    error.status = 404;
    throw error;
  }

  const result = await query(
    `SELECT id, local_path FROM repositories WHERE id::text = $1 AND workspace_id = $2`,
    [repositoryId, workspace.id]
  );

  const repository = result.rows[0];
  if (!repository) {
    const error = new Error("repository_not_found");
    error.status = 404;
    throw error;
  }

  const activeJob = await findActiveRepositoryIndex(repository.id);
  if (activeJob) {
    const error = new Error("repository_index_already_running");
    error.status = 409;
    throw error;
  }

  if (repository.local_path) {
    const resolved = path.resolve(repository.local_path);
    const root = path.resolve(reposRoot);
    if (resolved.startsWith(root)) {
      await fs.rm(resolved, { recursive: true, force: true });
    }
  }

  await cleanupRepositoryIndex(repository.id);
  await query("DELETE FROM repositories WHERE id = $1", [repository.id]);
  return { deleted: true };
}

async function reindexRepository(workspaceIdOrSlug, repositoryId) {
  const workspace = await getWorkspace(workspaceIdOrSlug);
  if (!workspace) {
    const error = new Error("workspace_not_found");
    error.status = 404;
    throw error;
  }

  const result = await query(
    `SELECT id, workspace_id, name, provider, url, default_branch, local_path, status, metadata, created_at, updated_at
     FROM repositories
     WHERE id::text = $1 AND workspace_id = $2`,
    [repositoryId, workspace.id]
  );

  const repository = result.rows[0];
  if (!repository) {
    const error = new Error("repository_not_found");
    error.status = 404;
    throw error;
  }

  if (!repository.local_path || !existsSync(repository.local_path)) {
    const error = new Error("repository_local_path_not_found");
    error.status = 404;
    throw error;
  }

  const activeJob = await findActiveRepositoryIndex(repository.id);
  if (activeJob) {
    const error = new Error("repository_index_already_running");
    error.status = 409;
    throw error;
  }

  const updated = await query(
    `UPDATE repositories
     SET status = 'index_queued', updated_at = NOW()
     WHERE id = $1
     RETURNING id, workspace_id, name, provider, url, default_branch, local_path, status, metadata, created_at, updated_at`,
    [repository.id]
  );

  await enqueueRepositoryIndex(workspace, updated.rows[0]);
  return updated.rows[0];
}

async function cancelIndexJob(workspaceIdOrSlug, jobId) {
  const workspace = await getWorkspace(workspaceIdOrSlug);
  if (!workspace) {
    const error = new Error("workspace_not_found");
    error.status = 404;
    throw error;
  }

  const result = await query(
    `SELECT id, repository_id, workspace_id, status, phase
     FROM code_index_jobs
     WHERE id::text = $1 AND workspace_id = $2`,
    [jobId, workspace.id]
  );
  const job = result.rows[0];
  if (!job) {
    const error = new Error("index_job_not_found");
    error.status = 404;
    throw error;
  }

  if (!activeIndexStatuses.includes(job.status)) {
    const error = new Error("index_job_not_running");
    error.status = 409;
    throw error;
  }

  if (["queued", "paused"].includes(job.status)) {
    await query("UPDATE code_index_jobs SET status = 'canceled', phase = 'canceled', finished_at = NOW() WHERE id = $1", [job.id]);
    return { workspace, job: { ...job, status: "canceled", phase: "canceled" } };
  }

  await query(
    `UPDATE code_index_jobs
     SET status = 'canceling', phase = 'canceling', error = NULL
     WHERE id = $1`,
    [job.id]
  );

  const activeJob = activeIndexJobs.get(job.id);
  if (activeJob) {
    activeJob.controller.abort();
  } else {
    await cleanupRepositoryIndex(job.repository_id).catch((cleanupError) => console.error("stale canceled index cleanup failed", cleanupError));
    await query(
      `UPDATE code_index_jobs
       SET status = 'canceled', phase = 'canceled', current_file = NULL, finished_at = NOW()
       WHERE id = $1`,
      [job.id]
    );
    await query(
      `UPDATE repositories
       SET status = 'index_canceled', metadata = metadata || $2::jsonb, updated_at = NOW()
       WHERE id = $1`,
      [job.repository_id, JSON.stringify({ index_canceled: new Date().toISOString() })]
    );
  }

  const updated = await query(
    `SELECT
       j.id,
       j.repository_id,
       r.name AS repository_name,
       j.workspace_id,
       j.scope,
       j.status,
       j.phase,
       j.current_repository,
       j.current_file,
       j.total_files,
       j.files_indexed,
       j.total_repository_files,
       j.skipped_files,
       j.total_chunks,
       j.chunks_indexed,
       j.symbols_indexed,
       j.started_at,
       j.finished_at,
       j.error,
       j.created_at
     FROM code_index_jobs j
     LEFT JOIN repositories r ON r.id = j.repository_id
     WHERE j.id = $1`,
    [job.id]
  );

  return { workspace, job: updated.rows[0] };
}

async function updateIndexJobQueue(workspaceIdOrSlug, jobId, action, payload = {}) {
  const workspace = await getWorkspace(workspaceIdOrSlug);
  if (!workspace) { const error = new Error("workspace_not_found"); error.status = 404; throw error; }
  const result = await query("SELECT id, status, priority, queue_position FROM code_index_jobs WHERE id::text = $1 AND workspace_id = $2", [jobId, workspace.id]);
  const job = result.rows[0];
  if (!job) { const error = new Error("index_job_not_found"); error.status = 404; throw error; }
  if (action === "pause") {
    if (job.status !== "queued") { const error = new Error("only_queued_job_can_be_paused"); error.status = 409; throw error; }
    await query("UPDATE code_index_jobs SET status = 'paused', phase = 'paused' WHERE id = $1", [job.id]);
  } else if (action === "resume") {
    if (job.status !== "paused") { const error = new Error("only_paused_job_can_be_resumed"); error.status = 409; throw error; }
    await query("UPDATE code_index_jobs SET status = 'queued', phase = 'queued' WHERE id = $1", [job.id]);
  } else if (action === "priority") {
    const priority = Math.max(0, Math.min(1000, Number(payload.priority)));
    if (!Number.isFinite(priority)) { const error = new Error("invalid_priority"); error.status = 400; throw error; }
    await query("UPDATE code_index_jobs SET priority = $2 WHERE id = $1 AND status IN ('queued', 'paused')", [job.id, priority]);
  } else if (["top", "up", "down"].includes(action)) {
    if (job.status !== "queued") { const error = new Error("only_queued_job_can_be_reordered"); error.status = 409; throw error; }
    if (action === "top") await query("UPDATE code_index_jobs SET queue_position = 0 WHERE id = $1", [job.id]);
    else {
      const operator = action === "up" ? "<" : ">";
      const order = action === "up" ? "DESC" : "ASC";
      const neighbor = await query(`SELECT id, queue_position FROM code_index_jobs WHERE workspace_id = $1 AND status = 'queued' AND queue_position ${operator} $2 ORDER BY queue_position ${order} LIMIT 1`, [workspace.id, job.queue_position]);
      if (neighbor.rows[0]) await query("UPDATE code_index_jobs SET queue_position = CASE WHEN id = $1 THEN $2 WHEN id = $3 THEN $4 END WHERE id IN ($1, $3)", [job.id, neighbor.rows[0].queue_position, neighbor.rows[0].id, job.queue_position]);
    }
  } else { const error = new Error("invalid_queue_action"); error.status = 400; throw error; }
  void runIndexScheduler();
  return { workspace };
}

async function updateQueueSettings(payload) {
  const paused = typeof payload.paused === "boolean" ? payload.paused : null;
  const concurrent = payload.max_concurrent_repositories === undefined ? null : Math.min(3, Math.max(1, Number(payload.max_concurrent_repositories)));
  if (concurrent !== null && !Number.isFinite(concurrent)) { const error = new Error("invalid_max_concurrent_repositories"); error.status = 400; throw error; }
  await query(`UPDATE code_index_queue_settings SET paused = COALESCE($1, paused), max_concurrent_repositories = COALESCE($2, max_concurrent_repositories), updated_at = NOW() WHERE id = TRUE`, [paused, concurrent]);
  const settings = await getQueueSettings();
  if (!settings.paused) void runIndexScheduler();
  return settings;
}

function inferRepoName(url) {
  const cleaned = String(url || "").replace(/\.git$/, "");
  const parts = cleaned.split(/[/:]/).filter(Boolean);
  return parts[parts.length - 1] || "";
}

async function listRemoteRepositories(url) {
  const provider = url.searchParams.get("provider") || "github";
  const owner = url.searchParams.get("owner") || process.env.GITHUB_OWNER || "";
  const token = process.env.GITHUB_TOKEN || "";

  if (provider !== "github") {
    const error = new Error("provider_not_supported");
    error.status = 400;
    throw error;
  }

  if (!token) {
    const error = new Error("github_token_required");
    error.status = 400;
    throw error;
  }

  const repos = await fetchGithubVisibleRepositories(token, owner);

  if (owner && repos.length === 0) {
    const error = new Error("github_owner_without_visible_repositories_for_token");
    error.status = 404;
    throw error;
  }

  return {
    provider,
    owner,
    repositories: repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      private: repo.private,
      default_branch: repo.default_branch,
      url: repo.clone_url,
      ssh_url: repo.ssh_url,
      updated_at: repo.updated_at
    }))
  };
}

async function fetchGithubVisibleRepositories(token, owner) {
  const ownerFilter = owner.trim().toLowerCase();
  const repos = await fetchGithubRepositories(
    "https://api.github.com/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&per_page=100&sort=updated",
    token
  );

  if (!ownerFilter) {
    return repos;
  }

  return repos.filter((repo) => String(repo.owner?.login || "").toLowerCase() === ownerFilter);
}

async function fetchGithubRepositories(endpoint, token) {
  const repos = [];
  let nextUrl = endpoint;

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: {
        "accept": "application/vnd.github+json",
        "authorization": `Bearer ${token}`,
        "user-agent": "ai-knowledge-platform-admin",
        "x-github-api-version": "2022-11-28"
      },
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      const detail = await response.text();
      const error = new Error(githubErrorMessage(response.status, detail));
      error.status = response.status;
      error.githubStatus = response.status;
      throw error;
    }

    repos.push(...await response.json());
    nextUrl = parseNextLink(response.headers.get("link"));
  }

  return repos;
}

function parseNextLink(linkHeader) {
  if (!linkHeader) {
    return null;
  }

  const links = linkHeader.split(",");
  for (const link of links) {
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function githubErrorMessage(status, detail) {
  if (status === 401) {
    return "github_token_invalid";
  }
  if (status === 403) {
    return "github_token_forbidden_or_rate_limited";
  }
  if (status === 404) {
    return "github_owner_not_found_or_token_without_access";
  }

  return `github_list_failed_${status}${detail ? `: ${detail.slice(0, 240)}` : ""}`;
}

async function serveStatic(req, res, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(publicDir, `.${cleanPath}`);

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    sendText(res, 200, data, contentTypes[ext] || "application/octet-stream");
  } catch {
    const index = await fs.readFile(path.join(publicDir, "index.html"), "utf8");
    sendText(res, 200, index, "text/html; charset=utf-8");
  }
}

function routeMatch(pathname, pattern) {
  const pathParts = pathname.split("/").filter(Boolean);
  const patternParts = pattern.split("/").filter(Boolean);
  if (pathParts.length !== patternParts.length) {
    return null;
  }

  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const part = patternParts[index];
    if (part.startsWith(":")) {
      params[part.slice(1)] = decodeURIComponent(pathParts[index]);
    } else if (part !== pathParts[index]) {
      return null;
    }
  }
  return params;
}

async function handleApi(req, res, url) {
  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/services") {
    sendJson(res, 200, await servicesPayload(req));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/containers") {
    sendJson(res, 200, await listContainers());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/mcp") {
    sendJson(res, 200, await mcpGatewayInfo(req));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/git/repositories") {
    sendJson(res, 200, await listRemoteRepositories(url));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/workspaces") {
    sendJson(res, 200, { workspaces: await listWorkspaces() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/workspaces") {
    sendJson(res, 201, { workspace: await createWorkspace(await readBody(req)) });
    return;
  }

  const workspaceParams = routeMatch(url.pathname, "/api/workspaces/:workspace");
  if (workspaceParams && req.method === "GET") {
    const workspace = await getWorkspace(workspaceParams.workspace);
    if (!workspace) {
      sendJson(res, 404, { error: "workspace_not_found" });
      return;
    }
    sendJson(res, 200, { workspace });
    return;
  }

  if (workspaceParams && req.method === "PUT") {
    sendJson(res, 200, { workspace: await updateWorkspace(workspaceParams.workspace, await readBody(req)) });
    return;
  }

  if (workspaceParams && req.method === "DELETE") {
    sendJson(res, 200, await deleteWorkspace(workspaceParams.workspace));
    return;
  }

  const repoCollectionParams = routeMatch(url.pathname, "/api/workspaces/:workspace/repositories");
  if (repoCollectionParams && req.method === "GET") {
    sendJson(res, 200, await listRepositories(repoCollectionParams.workspace));
    return;
  }

  if (repoCollectionParams && req.method === "POST") {
    sendJson(res, 201, { repository: await addRepository(repoCollectionParams.workspace, await readBody(req)) });
    return;
  }

  const indexJobsParams = routeMatch(url.pathname, "/api/workspaces/:workspace/index-jobs");
  if (indexJobsParams && req.method === "GET") {
    sendJson(res, 200, await listWorkspaceIndexJobs(indexJobsParams.workspace, {
      state: url.searchParams.get("state") || "all",
      page: url.searchParams.get("page") || "1",
      limit: url.searchParams.get("limit") || "10"
    }));
    return;
  }

  if (url.pathname === "/api/index-queue" && req.method === "GET") {
    sendJson(res, 200, await getQueueSettings());
    return;
  }
  if (url.pathname === "/api/index-queue" && req.method === "PUT") {
    sendJson(res, 200, await updateQueueSettings(await readBody(req)));
    return;
  }

  const queueActionParams = routeMatch(url.pathname, "/api/workspaces/:workspace/index-jobs/:job/queue/:action");
  if (queueActionParams && req.method === "POST") {
    sendJson(res, 200, await updateIndexJobQueue(queueActionParams.workspace, queueActionParams.job, queueActionParams.action, await readBody(req)));
    return;
  }

  const cancelIndexJobParams = routeMatch(url.pathname, "/api/workspaces/:workspace/index-jobs/:job/cancel");
  if (cancelIndexJobParams && req.method === "POST") {
    sendJson(res, 200, await cancelIndexJob(cancelIndexJobParams.workspace, cancelIndexJobParams.job));
    return;
  }

  const repoReportParams = routeMatch(url.pathname, "/api/workspaces/:workspace/repositories/:repository/index-report");
  if (repoReportParams && req.method === "GET") {
    sendJson(res, 200, await getRepositoryIndexReport(repoReportParams.workspace, repoReportParams.repository));
    return;
  }

  const repoParams = routeMatch(url.pathname, "/api/workspaces/:workspace/repositories/:repository");
  if (repoParams && req.method === "POST") {
    sendJson(res, 200, { repository: await reindexRepository(repoParams.workspace, repoParams.repository) });
    return;
  }

  if (repoParams && req.method === "DELETE") {
    sendJson(res, 200, await deleteRepository(repoParams.workspace, repoParams.repository));
    return;
  }

  sendJson(res, 404, { error: "not_found" });
}

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { status: "ok", service: "admin" });
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    try {
      await handleApi(req, res, url);
    } catch (error) {
      const status = error.status || (error.message === "invalid_json" ? 400 : 500);
      sendJson(res, status, {
        error: error instanceof Error ? error.message : "internal_error"
      });
    }
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  await serveStatic(req, res, url.pathname);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error(error);
    sendJson(res, 500, { error: "internal_error" });
  });
});

ensureApplicationSchema()
  .then(() => {
    void runIndexScheduler();
    setInterval(() => void runIndexScheduler(), 2000).unref();
    server.listen(port, "0.0.0.0", () => {
      console.log(`admin listening on ${port}`);
    });
  })
  .catch((error) => {
    console.error("admin schema initialization failed", error);
    process.exit(1);
  });
