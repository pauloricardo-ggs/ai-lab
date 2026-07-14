import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { githubRoutingHint, toolDefinition, toolNames, toolRoutes, validateToolArguments } from "./tools.js";

const port = Number(process.env.PORT || 7000);
const gatewayApiKey = process.env.GATEWAY_API_KEY || "";
const workspaceApiKeys = parseWorkspaceApiKeys(process.env.GATEWAY_WORKSPACE_KEYS_JSON || "");
const protocolVersion = "2025-11-25";
const supportedProtocolVersions = ["2025-03-26", "2025-06-18", "2025-11-25"];

const serviceRoutes = {
  code: process.env.CODE_MCP_URL || "http://code-mcp:7102",
  git: process.env.GIT_MCP_URL || "http://git-mcp:7103"
};

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

function rpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function parseWorkspaceApiKeys(raw) {
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw);
    return new Map(Object.entries(parsed).filter(([slug, key]) => slug && typeof key === "string" && key));
  } catch {
    throw new Error("invalid_GATEWAY_WORKSPACE_KEYS_JSON");
  }
}

function authorizationContext(req) {
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const presented = bearer || String(req.headers["x-api-key"] || "");
  if (!gatewayApiKey && workspaceApiKeys.size === 0) return { authorized: true, workspaceSlug: null };
  if (gatewayApiKey && secretsEqual(presented, gatewayApiKey)) return { authorized: true, workspaceSlug: null };
  for (const [workspaceSlug, key] of workspaceApiKeys) {
    if (secretsEqual(presented, key)) return { authorized: true, workspaceSlug };
  }
  return { authorized: false, workspaceSlug: null };
}

function secretsEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) { reject(new Error("payload_too_large")); req.destroy(); }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("parse_error")); }
    });
    req.on("error", reject);
  });
}

function proxyTool(serviceName, toolName, payload, requestId) {
  const target = new URL(`/tools/${encodeURIComponent(toolName)}`, serviceRoutes[serviceName]);
  return new Promise((resolve, reject) => {
    const request = http.request(target, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-by": "mcp-gateway", "x-request-id": requestId }, timeout: 30_000 }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => {
        try { resolve({ statusCode: response.statusCode || 502, body: raw ? JSON.parse(raw) : {} }); }
        catch { resolve({ statusCode: 502, body: { error: "invalid_upstream_response", service: serviceName } }); }
      });
    });
    request.on("timeout", () => request.destroy(new Error("upstream_timeout")));
    request.on("error", reject);
    request.end(JSON.stringify(payload));
  });
}

async function handleRpc(message, defaultWorkspaceSlug = "") {
  const id = message?.id;
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return rpcError(id, -32600, "Invalid Request");
  if (message.method === "initialize") {
    const requestedVersion = message.params?.protocolVersion;
    const negotiatedVersion = supportedProtocolVersions.includes(requestedVersion) ? requestedVersion : protocolVersion;
    const workspaceInstruction = defaultWorkspaceSlug
      ? `Servidor de codigo fixado no workspace_slug ${defaultWorkspaceSlug}. Use code_research_flow para fluxos e regras. Tools git_* consultam apenas clones locais; use um MCP GitHub dedicado para pull requests, issues e operacoes remotas.`
      : "Todas as tools exigem workspace_slug ou workspace_id. Este Gateway consulta codigo indexado e clones Git locais; documentos pertencem exclusivamente ao Open WebUI e operacoes remotas pertencem ao MCP GitHub dedicado.";
    return { jsonrpc: "2.0", id, result: { protocolVersion: negotiatedVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "ai-code-platform", version: "1.1.0" }, instructions: workspaceInstruction } };
  }
  if (message.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: toolNames.map((name) => toolDefinition(name, defaultWorkspaceSlug)) } };
  if (message.method !== "tools/call") return rpcError(id, -32601, "Method not found");

  const name = message.params?.name;
  const githubHint = githubRoutingHint(name);
  if (githubHint) return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(githubHint, null, 2) }], isError: true } };
  const serviceName = toolRoutes[name];
  if (!serviceName) return rpcError(id, -32602, "Unknown tool", { name, available_tools: toolNames });
  const validation = validateToolArguments(name, message.params?.arguments, defaultWorkspaceSlug);
  if (validation.error) return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(validation, null, 2) }], isError: true } };
  const args = validation.args;

  try {
    const startedAt = Date.now();
    const requestId = randomUUID();
    console.log(JSON.stringify({ event: "mcp_tool_call", request_id: requestId, tool: name, service: serviceName, workspace_slug: args.workspace_slug || null, workspace_id: args.workspace_id || null, repository_id: args.repository_id || null }));
    const upstream = await proxyTool(serviceName, name, args, requestId);
    const isError = upstream.statusCode >= 400;
    console.log(JSON.stringify({ event: "mcp_tool_result", request_id: requestId, tool: name, service: serviceName, status: upstream.statusCode, is_error: isError, result_count: Array.isArray(upstream.body?.matches) ? upstream.body.matches.length : Array.isArray(upstream.body?.items) ? upstream.body.items.length : null, fallback_used: upstream.body?.fallback_used || false, latency_ms: Date.now() - startedAt }));
    return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(upstream.body, null, 2) }], isError } };
  } catch (error) {
    return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: error instanceof Error ? error.message : "gateway_error" }], isError: true } };
  }
}

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  const requestedWorkspaceSlug = String(url.searchParams.get("workspace_slug") || "").trim();
  if (req.method === "GET" && pathname === "/health") { sendJson(res, 200, { status: "ok", service: "mcp-gateway", tools: toolNames.length, document_tools: false }); return; }
  if (!["/mcp", "/mcp/"].includes(pathname)) { sendJson(res, 404, { error: "mcp_endpoint_not_found" }); return; }
  if (!originAllowed(req)) { sendJson(res, 403, rpcError(null, -32000, "Origin not allowed")); return; }
  const auth = authorizationContext(req);
  if (!auth.authorized) { sendJson(res, 401, rpcError(null, -32001, "Unauthorized"), { "www-authenticate": "Bearer" }); return; }
  if (auth.workspaceSlug && requestedWorkspaceSlug && auth.workspaceSlug !== requestedWorkspaceSlug) { sendJson(res, 403, rpcError(null, -32003, "Workspace scope forbidden")); return; }
  const defaultWorkspaceSlug = auth.workspaceSlug || requestedWorkspaceSlug;
  if (req.method === "GET") {
    if (!String(req.headers.accept || "").includes("text/event-stream")) { res.writeHead(406); res.end(); return; }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(": MCP stream established\n\n");
    return;
  }
  if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }); res.end(); return; }
  try {
    const message = await readBody(req);
    const response = await handleRpc(message, defaultWorkspaceSlug);
    if (typeof message?.method === "string" && message.method.startsWith("notifications/")) { res.writeHead(202); res.end(); return; }
    sendJson(res, 200, response, { "mcp-protocol-version": protocolVersion });
  } catch (error) {
    sendJson(res, 400, rpcError(null, -32700, error instanceof Error ? error.message : "Parse error"));
  }
}

http.createServer((req, res) => handleRequest(req, res).catch((error) => sendJson(res, 500, rpcError(null, -32603, String(error))))).listen(port, "0.0.0.0", () => {
  console.log(`MCP gateway listening on ${port}/mcp`);
});
