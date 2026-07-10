import http from "node:http";
import { spawn } from "node:child_process";
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
    const updated = await query(
      `UPDATE repositories
       SET status = 'active', updated_at = NOW()
       WHERE id = $1
       RETURNING id, workspace_id, name, provider, url, default_branch, local_path, status, metadata, created_at, updated_at`,
      [repository.id]
    );
    return updated.rows[0];
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

  if (repository.local_path) {
    const resolved = path.resolve(repository.local_path);
    const root = path.resolve(reposRoot);
    if (resolved.startsWith(root)) {
      await fs.rm(resolved, { recursive: true, force: true });
    }
  }

  await query("DELETE FROM repositories WHERE id = $1", [repository.id]);
  return { deleted: true };
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

  const repoParams = routeMatch(url.pathname, "/api/workspaces/:workspace/repositories/:repository");
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

http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error(error);
    sendJson(res, 500, { error: "internal_error" });
  });
}).listen(port, "0.0.0.0", () => {
  console.log(`admin listening on ${port}`);
});
