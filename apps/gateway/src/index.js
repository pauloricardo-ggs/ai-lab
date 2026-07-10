import http from "node:http";

const port = Number(process.env.PORT || 7000);
const gatewayApiKey = process.env.GATEWAY_API_KEY || "";
const protocolVersion = "2025-11-25";
const supportedProtocolVersions = ["2025-03-26", "2025-06-18", "2025-11-25"];

const serviceRoutes = {
  knowledge: process.env.KNOWLEDGE_MCP_URL || "http://knowledge-mcp:7101",
  code: process.env.CODE_MCP_URL || "http://code-mcp:7102",
  git: process.env.GIT_MCP_URL || "http://git-mcp:7103"
};

const toolRoutes = {
  "knowledge.search_documents": "knowledge", "knowledge.list_documents": "knowledge", "knowledge.get_document": "knowledge",
  "knowledge.search_business_rules": "knowledge", "knowledge.search_embeddings": "knowledge",
  "code.search_symbol": "code", "code.get_class": "code", "code.get_method": "code", "code.find_references": "code",
  "code.find_callers": "code", "code.find_callees": "code", "code.find_dependencies": "code", "code.explain_architecture": "code",
  "code.find_related_documents": "code", "code.search_code": "code", "code.semantic_search_code": "code",
  "git.get_history": "git", "git.get_diff": "git", "git.get_commit": "git", "git.get_branch": "git",
  "git.get_pull_request": "git", "git.list_changed_files": "git", "git.find_commits_touching_symbol": "git", "git.search_commit_message": "git"
};

const toolDescriptions = {
  "code.semantic_search_code": "Busca semanticamente trechos de código indexado no workspace.",
  "code.search_code": "Busca trechos de código por relevância no workspace.",
  "code.search_symbol": "Localiza símbolos de código por nome.",
  "code.get_class": "Localiza classes, interfaces, records e structs.",
  "code.get_method": "Localiza métodos e funções.",
  "code.find_references": "Encontra referências, imports, dependências e chamadas de um símbolo.",
  "code.find_callers": "Encontra chamadores de um símbolo.",
  "code.find_callees": "Encontra chamadas originadas por um símbolo.",
  "code.find_dependencies": "Encontra imports e dependências do código.",
  "code.explain_architecture": "Retorna dados para explicar a arquitetura indexada.",
  "code.find_related_documents": "Encontra documentos relacionados ao código.",
  "knowledge.search_documents": "Busca documentos no workspace.",
  "knowledge.list_documents": "Lista documentos do workspace.",
  "knowledge.get_document": "Obtém um documento do workspace.",
  "knowledge.search_business_rules": "Busca regras de negócio indexadas.",
  "knowledge.search_embeddings": "Busca semântica em documentos.",
  "git.get_history": "Consulta histórico Git.", "git.get_diff": "Consulta diff Git.", "git.get_commit": "Consulta commit Git.",
  "git.get_branch": "Consulta branch Git.", "git.get_pull_request": "Consulta pull request Git.",
  "git.list_changed_files": "Lista arquivos alterados.", "git.find_commits_touching_symbol": "Encontra commits que tocaram um símbolo.",
  "git.search_commit_message": "Busca mensagens de commit."
};

function toolDefinition(name) {
  return {
    name,
    description: toolDescriptions[name] || `Executa ${name}.`,
    inputSchema: {
      type: "object",
      properties: {
        workspace_slug: { type: "string", description: "Slug do workspace a consultar." },
        workspace_id: { type: "string", description: "UUID do workspace a consultar." },
        repository_id: { type: "string", description: "UUID opcional para restringir ao repositório." },
        query: { type: "string", description: "Consulta em linguagem natural ou texto de busca." },
        symbol: { type: "string", description: "Nome do símbolo para consultas de código." },
        name: { type: "string", description: "Nome do recurso consultado." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Máximo de resultados." }
      },
      anyOf: [{ required: ["workspace_slug"] }, { required: ["workspace_id"] }],
      additionalProperties: true
    }
  };
}

const tools = Object.keys(toolRoutes).sort().map(toolDefinition);

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

function rpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function isAuthorized(req) {
  if (!gatewayApiKey) return true;
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return bearer === gatewayApiKey || req.headers["x-api-key"] === gatewayApiKey;
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

function proxyTool(serviceName, toolName, payload) {
  const target = new URL(`/tools/${encodeURIComponent(toolName)}`, serviceRoutes[serviceName]);
  return new Promise((resolve, reject) => {
    const request = http.request(target, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-by": "mcp-gateway" }, timeout: 30_000 }, (response) => {
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

async function handleRpc(message) {
  const id = message?.id;
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return rpcError(id, -32600, "Invalid Request");
  if (message.method === "initialize") {
    const requestedVersion = message.params?.protocolVersion;
    const negotiatedVersion = supportedProtocolVersions.includes(requestedVersion) ? requestedVersion : protocolVersion;
    return { jsonrpc: "2.0", id, result: { protocolVersion: negotiatedVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "ai-knowledge-platform", version: "1.0.0" }, instructions: "Todas as tools exigem workspace_slug ou workspace_id." } };
  }
  if (message.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools } };
  if (message.method !== "tools/call") return rpcError(id, -32601, "Method not found");

  const name = message.params?.name;
  const args = message.params?.arguments || {};
  const serviceName = toolRoutes[name];
  if (!serviceName) return rpcError(id, -32602, "Unknown tool", { name });
  if (!args.workspace_id && !args.workspace_slug) return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "Informe workspace_slug ou workspace_id." }], isError: true } };

  try {
    const upstream = await proxyTool(serviceName, name, args);
    const isError = upstream.statusCode >= 400;
    return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(upstream.body, null, 2) }], isError } };
  } catch (error) {
    return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: error instanceof Error ? error.message : "gateway_error" }], isError: true } };
  }
}

async function handleRequest(req, res) {
  if (req.url !== "/mcp") { sendJson(res, 404, { error: "mcp_endpoint_not_found" }); return; }
  if (!originAllowed(req)) { sendJson(res, 403, rpcError(null, -32000, "Origin not allowed")); return; }
  if (!isAuthorized(req)) { sendJson(res, 401, rpcError(null, -32001, "Unauthorized"), { "www-authenticate": "Bearer" }); return; }
  if (req.method === "GET") {
    if (!String(req.headers.accept || "").includes("text/event-stream")) { res.writeHead(406); res.end(); return; }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(": MCP stream established\n\n");
    return;
  }
  if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }); res.end(); return; }
  try {
    const message = await readBody(req);
    const response = await handleRpc(message);
    if (message.method.startsWith("notifications/")) { res.writeHead(202); res.end(); return; }
    sendJson(res, 200, response, { "mcp-protocol-version": protocolVersion });
  } catch (error) {
    sendJson(res, 400, rpcError(null, -32700, error instanceof Error ? error.message : "Parse error"));
  }
}

http.createServer((req, res) => handleRequest(req, res).catch((error) => sendJson(res, 500, rpcError(null, -32603, String(error))))).listen(port, "0.0.0.0", () => {
  console.log(`MCP gateway listening on ${port}/mcp`);
});
