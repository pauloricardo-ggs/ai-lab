import http from "node:http";

const port = Number(process.env.PORT || 7103);
const serviceName = process.env.SERVICE_NAME || "git-mcp";
const reposRoot = process.env.REPOS_ROOT || "/repos";
const tools = [
  "git.get_commit",
  "git.get_history",
  "git.get_pull_request",
  "git.get_diff",
  "git.get_branch",
  "git.list_changed_files",
  "git.find_commits_touching_symbol",
  "git.search_commit_message"
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

function executeTool(tool, payload) {
  return {
    status: "ok",
    tool,
    workspace: payload.workspace_id || payload.workspace_slug,
    repository_id: payload.repository_id || null,
    repos_root: reposRoot,
    result: null,
    items: [],
    note: "Implementacao pendente: conecte repositorios sincronizados em /repos para consultar historico, branches, diffs e commits."
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

  sendJson(res, 200, executeTool(tool, payload));
}

http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    const message = error instanceof Error ? error.message : "internal_error";
    sendJson(res, message === "invalid_json" ? 400 : 500, { error: message });
  });
}).listen(port, "0.0.0.0", () => {
  console.log(`${serviceName} listening on ${port}`);
});
