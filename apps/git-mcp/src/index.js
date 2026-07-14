import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
const run = promisify(execFile);
const port = Number(process.env.PORT || 7103);
const serviceName = process.env.SERVICE_NAME || "git-mcp";
const reposRoot = path.resolve(process.env.REPOS_ROOT || "/repos");
const maxOutput = Number(process.env.GIT_MCP_MAX_OUTPUT_BYTES || 2_000_000);
const pool = new Pool({
  host: process.env.POSTGRES_HOST || "postgres",
  port: Number(process.env.POSTGRES_INTERNAL_PORT || 5432),
  database: process.env.POSTGRES_DB || "ai_platform",
  user: process.env.POSTGRES_USER || "ai_platform",
  password: process.env.POSTGRES_PASSWORD || undefined,
  max: 4
});
const tools = [
  "git_get_commit", "git_get_history", "git_get_diff", "git_get_branch",
  "git_list_changed_files", "git_find_commits_touching_symbol", "git_search_commit_message"
];

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; if (raw.length > 1_000_000) reject(new Error("payload_too_large")); });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("invalid_json")); } });
    req.on("error", reject);
  });
}
function toolNameFromPath(pathname) {
  const prefix = "/tools/";
  return pathname.startsWith(prefix) ? decodeURIComponent(pathname.slice(prefix.length)) : null;
}
function hasWorkspace(payload) { return Boolean(payload.workspace_id || payload.workspace_slug); }
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function boundedLimit(value, fallback = 25, maximum = 200) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.trunc(parsed), maximum)) : fallback;
}
function reference(value, fallback) {
  const ref = String(value || fallback);
  if (!ref || ref.length > 500 || ref.startsWith("-") || /[\0\r\n]/.test(ref)) fail("invalid_git_reference");
  return ref;
}
function relativeGitPath(value) {
  if (value === undefined || value === null || value === "") return null;
  const candidate = String(value).replaceAll("\\", "/");
  if (candidate.length > 2000 || candidate.startsWith("/") || candidate.startsWith(":") || candidate.split("/").includes("..") || /[\0\r\n]/.test(candidate)) fail("invalid_repository_path");
  return candidate;
}
function regexLiteral(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

async function diffStartReference(cwd, value, fallback = "HEAD^") {
  const candidate = reference(value, fallback);
  try {
    await git(cwd, ["rev-parse", "--verify", candidate]);
    return candidate;
  } catch (error) {
    if (candidate.endsWith("^")) return EMPTY_TREE;
    throw error;
  }
}

async function resolveRepository(payload) {
  const workspaceKey = payload.workspace_id || payload.workspace_slug;
  const params = [workspaceKey];
  let repositoryFilter = "";
  if (payload.repository_id || payload.repository) {
    params.push(payload.repository_id || payload.repository);
    repositoryFilter = "AND (r.id::text = $2 OR r.name = $2)";
  }
  const result = await pool.query(
    `SELECT r.id, r.name, r.local_path, r.default_branch, r.indexed_commit_sha, r.metadata, w.slug AS workspace_slug
     FROM repositories r JOIN workspaces w ON w.id = r.workspace_id
     WHERE (w.id::text = $1 OR w.slug = $1) ${repositoryFilter}
     ORDER BY r.name LIMIT 2`, params);
  if (!result.rows.length) fail("repository_not_found", 404);
  if (result.rows.length > 1) fail("repository_required");
  const repository = result.rows[0];
  if (!repository.local_path) fail("repository_local_path_not_found", 404);
  const resolvedPath = path.resolve(repository.local_path);
  if (resolvedPath !== reposRoot && !resolvedPath.startsWith(`${reposRoot}${path.sep}`)) fail("repository_path_outside_repos_root", 403);
  await git(resolvedPath, ["rev-parse", "--git-dir"]);
  return { ...repository, local_path: resolvedPath };
}

async function git(cwd, args) {
  try {
    const { stdout } = await run("git", ["-c", "color.ui=false", "-c", "core.quotepath=false", ...args], {
      cwd, timeout: 30_000, maxBuffer: maxOutput, encoding: "utf8"
    });
    return stdout.trimEnd();
  } catch (cause) {
    const error = new Error("git_command_failed");
    error.status = cause.code === "ENOENT" ? 503 : 400;
    error.details = String(cause.stderr || cause.message || "").trim().slice(0, 2000);
    throw error;
  }
}
function parseRecords(text, fields) {
  if (!text) return [];
  return text.split("\x1e").filter(Boolean).map((record) => {
    const values = record.replace(/^\n/, "").split("\x1f");
    return Object.fromEntries(fields.map((field, index) => [field, values[index] ?? null]));
  });
}
const commitFormat = "%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1e";

async function executeTool(tool, payload) {
  const repository = await resolveRepository(payload);
  const cwd = repository.local_path;
  const base = { status: "ok", tool, workspace: repository.workspace_slug, repository_id: repository.id, repository: repository.name };
  if (tool === "git_get_branch") {
    const [branch, head, status] = await Promise.all([
      git(cwd, ["branch", "--show-current"]), git(cwd, ["rev-parse", "HEAD"]), git(cwd, ["status", "--short", "--branch"])
    ]);
    return { ...base, result: { branch: branch || null, head, indexed_commit: repository.indexed_commit_sha || null, status } };
  }
  if (tool === "git_get_commit") {
    const ref = reference(payload.commit || payload.ref, "HEAD");
    const records = parseRecords(await git(cwd, ["show", "-s", `--format=${commitFormat}`, ref]), ["sha", "short_sha", "author_name", "author_email", "authored_at", "subject", "decorations"]);
    const files = await changedFiles(cwd, `${ref}^`, ref).catch(() => changedFiles(cwd, EMPTY_TREE, ref));
    return { ...base, result: { ...records[0], files } };
  }
  if (tool === "git_get_history" || tool === "git_search_commit_message") {
    const messageQuery = String(payload.query || payload.message || "").trim();
    if (tool === "git_search_commit_message" && !messageQuery) fail("query_required");
    const args = ["log", `--max-count=${boundedLimit(payload.limit)}`, `--format=${commitFormat}`];
    if (payload.ref) args.push(reference(payload.ref));
    const requestedPath = relativeGitPath(payload.path);
    if (requestedPath) args.push("--", requestedPath);
    if (tool === "git_search_commit_message") args.splice(1, 0, "--fixed-strings", "--regexp-ignore-case", `--grep=${messageQuery.slice(0, 500)}`);
    return { ...base, items: parseRecords(await git(cwd, args), ["sha", "short_sha", "author_name", "author_email", "authored_at", "subject", "decorations"]) };
  }
  if (tool === "git_get_diff") {
    const from = await diffStartReference(cwd, payload.from || payload.base || repository.indexed_commit_sha);
    const to = reference(payload.to || payload.head, "HEAD");
    const args = ["diff", "--no-ext-diff", `--unified=${boundedLimit(payload.context, 3, 20)}`, from, to];
    const requestedPath = relativeGitPath(payload.path);
    if (requestedPath) args.push("--", requestedPath);
    return { ...base, result: { from, to, diff: await git(cwd, args), files: await changedFiles(cwd, from, to) } };
  }
  if (tool === "git_list_changed_files") {
    const from = await diffStartReference(cwd, payload.from || payload.base || repository.indexed_commit_sha);
    const to = reference(payload.to || payload.head, "HEAD");
    return { ...base, from, to, items: await changedFiles(cwd, from, to) };
  }
  if (tool === "git_find_commits_touching_symbol") {
    const symbol = String(payload.symbol || payload.query || "").trim();
    if (!symbol) fail("symbol_required");
    const args = ["log", `--max-count=${boundedLimit(payload.limit)}`, "-G", regexLiteral(symbol.slice(0, 500)), `--format=${commitFormat}`];
    const requestedPath = relativeGitPath(payload.path);
    if (requestedPath) args.push("--", requestedPath);
    return { ...base, query: symbol, items: parseRecords(await git(cwd, args), ["sha", "short_sha", "author_name", "author_email", "authored_at", "subject", "decorations"]) };
  }
  fail("tool_not_implemented", 501);
}
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
async function changedFiles(cwd, from, to) {
  const output = await git(cwd, ["diff", "--name-status", "-z", from, to]);
  const parts = output.split("\0").filter(Boolean);
  const items = [];
  for (let index = 0; index < parts.length;) {
    const status = parts[index++];
    const oldPath = parts[index++];
    if (/^[RC]/.test(status)) items.push({ status, old_path: oldPath, path: parts[index++] });
    else items.push({ status, path: oldPath });
  }
  return items;
}

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, { status: "ok", service: serviceName });
  if (req.method === "GET" && url.pathname === "/tools") return sendJson(res, 200, { service: serviceName, tools, requires_workspace: true });
  const tool = toolNameFromPath(url.pathname);
  if (req.method !== "POST" || !tool) return sendJson(res, 404, { error: "not_found" });
  if (!tools.includes(tool)) return sendJson(res, 404, { error: "unknown_tool", tool });
  const payload = await readBody(req);
  if (!hasWorkspace(payload)) return sendJson(res, 400, { error: "workspace_required" });
  sendJson(res, 200, await executeTool(tool, payload));
}
http.createServer((req, res) => handleRequest(req, res).catch((error) => sendJson(res, error.status || 500, { error: error.message || "internal_error", ...(error.details ? { details: error.details } : {}) })))
  .listen(port, "0.0.0.0", () => console.log(`${serviceName} listening on ${port}`));
