import http from "node:http";

const port = Number(process.env.PORT || 7000);
const gatewayApiKey = process.env.GATEWAY_API_KEY || "";

const serviceRoutes = {
  knowledge: process.env.KNOWLEDGE_MCP_URL || "http://knowledge-mcp:7101",
  code: process.env.CODE_MCP_URL || "http://code-mcp:7102",
  git: process.env.GIT_MCP_URL || "http://git-mcp:7103"
};

const toolRoutes = {
  "knowledge.search_documents": "knowledge",
  "knowledge.list_documents": "knowledge",
  "knowledge.get_document": "knowledge",
  "knowledge.search_business_rules": "knowledge",
  "knowledge.search_embeddings": "knowledge",
  "code.search_symbol": "code",
  "code.get_class": "code",
  "code.get_method": "code",
  "code.find_references": "code",
  "code.find_callers": "code",
  "code.find_callees": "code",
  "code.find_dependencies": "code",
  "code.explain_architecture": "code",
  "code.find_related_documents": "code",
  "code.search_code": "code",
  "code.semantic_search_code": "code",
  "git.get_history": "git",
  "git.get_diff": "git",
  "git.get_commit": "git",
  "git.get_branch": "git",
  "git.get_pull_request": "git",
  "git.list_changed_files": "git",
  "git.find_commits_touching_symbol": "git",
  "git.search_commit_message": "git"
};

const buckets = new Map();
const rateLimit = {
  windowMs: 60_000,
  maxRequests: Number(process.env.GATEWAY_RATE_LIMIT_PER_MINUTE || 120)
};

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
      if (raw.length > 1_000_000) {
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
  if (!gatewayApiKey) {
    return true;
  }

  return req.headers["x-api-key"] === gatewayApiKey;
}

function isRateLimited(req) {
  const key = req.headers["x-api-key"] || req.socket.remoteAddress || "anonymous";
  const now = Date.now();
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rateLimit.windowMs });
    return false;
  }

  current.count += 1;
  return current.count > rateLimit.maxRequests;
}

function hasWorkspace(payload) {
  return Boolean(payload.workspace_id || payload.workspace_slug);
}

function normalizeToolName(pathname) {
  const prefix = "/tools/";
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  return decodeURIComponent(pathname.slice(prefix.length));
}

function proxyTool(serviceName, toolName, payload) {
  const target = new URL(`/tools/${encodeURIComponent(toolName)}`, serviceRoutes[serviceName]);

  return new Promise((resolve, reject) => {
    const request = http.request(
      target,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-by": "ai-mcp-gateway"
        },
        timeout: 15_000
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          try {
            resolve({
              statusCode: response.statusCode || 502,
              body: raw ? JSON.parse(raw) : {}
            });
          } catch {
            resolve({
              statusCode: 502,
              body: { error: "invalid_upstream_response", service: serviceName }
            });
          }
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("upstream_timeout"));
    });
    request.on("error", reject);
    request.write(JSON.stringify(payload));
    request.end();
  });
}

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { status: "ok", service: "mcp-gateway" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/tools") {
    sendJson(res, 200, {
      tools: Object.keys(toolRoutes).sort(),
      requires_workspace: true
    });
    return;
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }

  if (isRateLimited(req)) {
    sendJson(res, 429, { error: "rate_limited" });
    return;
  }

  const toolName = normalizeToolName(url.pathname);
  if (req.method !== "POST" || !toolName) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }

  const serviceName = toolRoutes[toolName];
  if (!serviceName) {
    sendJson(res, 404, { error: "unknown_tool", tool: toolName });
    return;
  }

  try {
    const payload = await readBody(req);

    if (!hasWorkspace(payload)) {
      sendJson(res, 400, {
        error: "workspace_required",
        message: "Informe workspace_id ou workspace_slug para consultas MCP."
      });
      return;
    }

    console.log(JSON.stringify({
      event: "mcp_tool_call",
      service: serviceName,
      tool: toolName,
      workspace_id: payload.workspace_id || null,
      workspace_slug: payload.workspace_slug || null,
      actor: payload.actor || null
    }));

    const upstream = await proxyTool(serviceName, toolName, payload);
    sendJson(res, upstream.statusCode, upstream.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "gateway_error";
    const status = message === "invalid_json" ? 400 : 502;
    sendJson(res, status, { error: message });
  }
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error(error);
    sendJson(res, 500, { error: "internal_error" });
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`mcp-gateway listening on ${port}`);
});

