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
  [".sh", "shell"]
]);

const languageByFilename = new Map([
  ["dockerfile", "dockerfile"],
  ["makefile", "makefile"],
  ["license", "text"],
  [".gitignore", "gitignore"],
  [".dockerignore", "dockerignore"],
  [".env.example", "dotenv"]
]);

const maxIndexFileBytes = 512 * 1024;
const chunkLineSize = 120;
const chunkLineOverlap = 20;
const activeIndexJobs = new Map();
const activeIndexStatuses = ["pending", "running", "canceling"];

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
    healthUrl: "http://gateway:7000/health",
    toolsUrl: "http://gateway:7000/tools",
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

async function listGatewayTools(req) {
  const service = serviceDefinitions.find((item) => item.id === "mcp-gateway");
  const baseUrl = publicUrl(req, service).replace(/\/services\/mcp-gateway$/, "");

  try {
    const response = await fetch(service.toolsUrl, { signal: AbortSignal.timeout(2500) });
    const body = await response.json();
    return {
      base_url: baseUrl,
      gateway_api_key_configured: Boolean(gatewayApiKey),
      tools: body.tools || []
    };
  } catch (error) {
    return {
      base_url: baseUrl,
      gateway_api_key_configured: Boolean(gatewayApiKey),
      tools: [],
      error: error instanceof Error ? error.message : "tools_unavailable"
    };
  }
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
      started_at TIMESTAMP,
      finished_at TIMESTAMP,
      error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
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
  await query("CREATE INDEX IF NOT EXISTS idx_code_chunks_workspace_id ON code_chunks(workspace_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_chunks_repository_id ON code_chunks(repository_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_chunks_file_path ON code_chunks(file_path)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_symbols_repository_id ON code_symbols(repository_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_relationships_workspace_id ON code_relationships(workspace_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_relationships_repository_id ON code_relationships(repository_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_relationships_target_name ON code_relationships(target_name)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_relationships_type ON code_relationships(relationship_type)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_index_jobs_repository_id ON code_index_jobs(repository_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_code_index_jobs_workspace_id ON code_index_jobs(workspace_id)");
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
     WHERE ${whereSql}
     ORDER BY j.created_at DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );

  return {
    workspace,
    jobs: result.rows,
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

async function indexRepository(workspace, repository) {
  const existingJob = await findActiveRepositoryIndex(repository.id);
  if (existingJob) {
    const error = new Error("repository_index_already_running");
    error.status = 409;
    throw error;
  }

  const controller = new AbortController();
  const job = await query(
    `INSERT INTO code_index_jobs (repository_id, workspace_id, scope, status, phase, current_repository, started_at)
     VALUES ($1, $2, 'workspace', 'running', 'preparing', $3, NOW())
     RETURNING id`,
    [repository.id, workspace.id, repository.name]
  );
  const jobId = job.rows[0].id;
  activeIndexJobs.set(jobId, { controller, repositoryId: repository.id, workspaceId: workspace.id });

  try {
    assertIndexNotCanceled(controller.signal);
    await cleanupRepositoryIndex(repository.id);
    assertIndexNotCanceled(controller.signal);
    await ensureQdrantCollection(codeCollection);
    assertIndexNotCanceled(controller.signal);
    await ensureNeo4jSchema();

    await updateIndexJob(jobId, { phase: "scanning" });
    assertIndexNotCanceled(controller.signal);
    const scan = await collectIndexableFiles(repository.local_path);
    const files = scan.files;
    const chunks = [];
    const symbols = [];
    const relationships = [];

    await updateIndexJob(jobId, {
      phase: "extracting",
      totalFiles: files.length,
      totalRepositoryFiles: scan.stats.totalFiles,
      skippedFiles: scan.stats.skippedFiles
    });
    for (const file of files) {
      assertIndexNotCanceled(controller.signal);
      await updateIndexJob(jobId, { currentFile: file.relativePath });
      const content = await fs.readFile(file.absolutePath, "utf8");
      const fileChunks = chunkContent(content);
      const analysis = await analyzeCodeFile(content, file, controller.signal);
      chunks.push(...fileChunks.map((chunk) => ({ ...chunk, file })));
      symbols.push(...analysis.symbols);
      relationships.push(...analysis.relationships);
      await incrementIndexJob(jobId, { files: 1 });
    }

    let indexedChunks = 0;
    await updateIndexJob(jobId, { phase: "embedding", totalChunks: chunks.length, currentFile: null });
    for (const chunk of chunks) {
      assertIndexNotCanceled(controller.signal);
      await updateIndexJob(jobId, { currentFile: chunk.file.relativePath });
      const pointId = randomUUID();
      const embedding = await createEmbedding(buildChunkEmbeddingText(chunk), controller.signal);
      assertIndexNotCanceled(controller.signal);
      await upsertQdrantPoint(codeCollection, pointId, embedding, {
        workspace_id: workspace.id,
        workspace_slug: workspace.slug,
        repository_id: repository.id,
        repository_name: repository.name,
        source_type: "code",
        file_path: chunk.file.relativePath,
        language: chunk.file.language,
        chunk_index: chunk.index,
        start_line: chunk.startLine,
        end_line: chunk.endLine
      });
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
          workspace.id,
          repository.id,
          chunk.file.relativePath,
          chunk.file.language,
          chunk.index,
          chunk.startLine,
          chunk.endLine,
          chunk.content,
          sha256(chunk.content),
          codeCollection,
          pointId,
          { indexed_by: "admin-ui", embedding_model: embeddingModel }
        ]
      );
      indexedChunks += 1;
      await incrementIndexJob(jobId, { chunks: 1 });
    }

    await updateIndexJob(jobId, { phase: "symbols", currentFile: null });
    for (const symbol of symbols) {
      assertIndexNotCanceled(controller.signal);
      await query(
        `INSERT INTO code_symbols (
          workspace_id, repository_id, symbol_type, name, full_name, language,
          file_path, start_line, end_line, metadata
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          workspace.id,
          repository.id,
          symbol.type,
          symbol.name,
          symbol.fullName,
          symbol.language,
          symbol.filePath,
          symbol.line,
          symbol.line,
          { indexed_by: "admin-ui", ...(symbol.metadata || {}) }
        ]
      );
    }

    for (const relationship of relationships) {
      assertIndexNotCanceled(controller.signal);
      await query(
        `INSERT INTO code_relationships (
          workspace_id, repository_id, relationship_type, source_name, target_name,
          source_file_path, target_file_path, language, start_line, metadata
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          workspace.id,
          repository.id,
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

    await updateIndexJob(jobId, { phase: "graph", symbols: symbols.length });
    assertIndexNotCanceled(controller.signal);
    await upsertNeo4jRepository(workspace, repository, files, symbols, relationships);
    assertIndexNotCanceled(controller.signal);
    await query(
      `UPDATE code_index_jobs
       SET status = 'completed', phase = 'completed', current_file = NULL, files_indexed = $2, chunks_indexed = $3, symbols_indexed = $4, finished_at = NOW()
       WHERE id = $1`,
      [jobId, files.length, indexedChunks, symbols.length]
    );

    return { files: files.length, chunks: indexedChunks, symbols: symbols.length, relationships: relationships.length };
  } catch (error) {
    if (error instanceof IndexCanceledError || error.name === "AbortError") {
      await cleanupRepositoryIndex(repository.id).catch((cleanupError) => console.error("repository canceled index cleanup failed", cleanupError));
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

function startRepositoryIndex(workspace, repository) {
  indexRepository(workspace, repository)
    .then(async (indexResult) => {
      await query(
        `UPDATE repositories
         SET status = 'indexed', metadata = metadata || $2::jsonb, updated_at = NOW()
         WHERE id = $1`,
        [repository.id, JSON.stringify({ index: indexResult })]
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
    });
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
  await query("DELETE FROM code_relationships WHERE repository_id = $1", [repositoryId]);
  await query("DELETE FROM code_symbols WHERE repository_id = $1", [repositoryId]);
  await query("DELETE FROM code_chunks WHERE repository_id = $1", [repositoryId]);
}

async function collectIndexableFiles(rootPath) {
  const root = path.resolve(rootPath);
  const files = [];
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
      if (stat.size > maxIndexFileBytes) {
        stats.skippedFiles += 1;
        continue;
      }

      const language = await inferFileLanguage(absolutePath, entry.name);
      if (!language) {
        stats.skippedFiles += 1;
        continue;
      }

      files.push({
        absolutePath,
        relativePath: path.relative(root, absolutePath),
        language,
        size: stat.size
      });
    }
  }

  await visit(root);
  return { files, stats };
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

function chunkContent(content) {
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
        content: chunkText
      });
      index += 1;
    }
    if (end === lines.length) {
      break;
    }
  }

  return chunks;
}

async function analyzeCodeFile(content, file, signal) {
  if (file.language === "csharp" && roslynIndexerUrl) {
    try {
      return normalizeAnalysis(await analyzeCsharpWithRoslyn(content, file, signal));
    } catch (error) {
      console.warn("roslyn indexer unavailable, falling back to local csharp analyzer", error);
    }
  }

  const analyzer = languageAnalyzers[file.language] || analyzeGenericTree;
  return normalizeAnalysis(analyzer(content, file));
}

function normalizeAnalysis(analysis) {
  return {
    symbols: dedupeSymbols(analysis.symbols || []),
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
    signal: abortSignalWithTimeout(signal, 20_000)
  });

  if (!response.ok) {
    throw new Error(`roslyn_indexer_failed_${response.status}`);
  }

  const body = await response.json();
  return {
    symbols: (body.symbols || []).map((symbol) => createSymbol(file, symbol.type, symbol.name, symbol.line || 1, {
      indexer: "roslyn",
      full_name: symbol.full_name,
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

  for (const extractor of relationshipExtractors) {
    relationships.push(...extractor(content, file, symbols));
  }

  return { symbols, relationships };
}

function createSymbol(file, type, name, line, metadata = {}) {
  return {
    type,
    name,
    fullName: `${file.relativePath}#${name}`,
    language: file.language,
    filePath: file.relativePath,
    line,
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
    if (symbol.line <= line && (!current || symbol.line > current.line)) {
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

function indexerKindForLanguage(language) {
  if (language === "csharp") {
    return "roslyn-fallback";
  }
  if (["javascript", "typescript", "html", "css", "swift", "dart", "json", "yaml", "sql"].includes(language)) {
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
  sql: analyzeSql
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
    chunk.content
  ].join("\n");
}

async function createEmbedding(text, signal) {
  const response = await fetch(`${ollamaUrl}/api/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: embeddingModel, prompt: text }),
    signal: abortSignalWithTimeout(signal, 60_000)
  });

  if (!response.ok) {
    throw new Error(`ollama_embedding_failed_${response.status}: ${await response.text()}`);
  }

  const body = await response.json();
  if (!Array.isArray(body.embedding)) {
    throw new Error("ollama_embedding_missing_vector");
  }

  return body.embedding;
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
            s.repository_id = $repositoryId, s.workspace_id = $workspaceId, s.line = $line
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
        line: symbol.line
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
    signal: AbortSignal.timeout(30_000)
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
     SET status = 'indexing', updated_at = NOW()
     WHERE id = $1
     RETURNING id, workspace_id, name, provider, url, default_branch, local_path, status, metadata, created_at, updated_at`,
    [repository.id]
  );

  startRepositoryIndex(workspace, updated.rows[0]);
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
     SET status = 'indexing', updated_at = NOW()
     WHERE id = $1
     RETURNING id, workspace_id, name, provider, url, default_branch, local_path, status, metadata, created_at, updated_at`,
    [repository.id]
  );

  startRepositoryIndex(workspace, updated.rows[0]);
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

async function proxyGatewayTool(tool, payload) {
  const response = await fetch(`http://gateway:7000/tools/${encodeURIComponent(tool)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(gatewayApiKey ? { "x-api-key": gatewayApiKey } : {})
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000)
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  return {
    status: response.status,
    ok: response.ok,
    body
  };
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
    sendJson(res, 200, await listGatewayTools(req));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/mcp/test") {
    const body = await readBody(req);
    sendJson(res, 200, await proxyGatewayTool(body.tool, body.payload || {}));
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

  const cancelIndexJobParams = routeMatch(url.pathname, "/api/workspaces/:workspace/index-jobs/:job/cancel");
  if (cancelIndexJobParams && req.method === "POST") {
    sendJson(res, 200, await cancelIndexJob(cancelIndexJobParams.workspace, cancelIndexJobParams.job));
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
    server.listen(port, "0.0.0.0", () => {
      console.log(`admin listening on ${port}`);
    });
  })
  .catch((error) => {
    console.error("admin schema initialization failed", error);
    process.exit(1);
  });
