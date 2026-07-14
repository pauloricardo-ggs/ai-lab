import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import test from "node:test";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function freePort() {
  const server = http.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("gateway_start_timeout");
}

test("Gateway executa protocolo MCP, escopo, proxy e orientacao GitHub", async (context) => {
  const received = [];
  const upstream = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      received.push({ url: req.url, requestId: req.headers["x-request-id"], body: JSON.parse(raw || "{}") });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", matches: [{ id: 1 }] }));
    });
  });
  const upstreamPort = await listen(upstream);
  const gatewayPort = await freePort();
  const child = spawn(process.execPath, ["apps/gateway/src/index.js"], {
    cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, PORT: String(gatewayPort), CODE_MCP_URL: `http://127.0.0.1:${upstreamPort}`, GIT_MCP_URL: `http://127.0.0.1:${upstreamPort}`, GATEWAY_API_KEY: "", GATEWAY_WORKSPACE_KEYS_JSON: '{"fixture":"secret"}' }
  });
  context.after(async () => { child.kill("SIGTERM"); await close(upstream); });
  await waitForHealth(`http://127.0.0.1:${gatewayPort}/health`);

  const rpc = async (body, suffix = "?workspace_slug=fixture") => {
    const response = await fetch(`http://127.0.0.1:${gatewayPort}/mcp${suffix}`, {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer secret" }, body: JSON.stringify(body)
    });
    assert.equal(response.status, 200);
    return response.json();
  };

  const initialized = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } });
  assert.equal(initialized.result.serverInfo.name, "ai-code-platform");
  const listed = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.equal(listed.result.tools.length, 21);

  const called = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "code_search_code", arguments: { query: "cancelamento" } } });
  assert.equal(called.result.isError, false);
  assert.equal(received[0].body.workspace_slug, "fixture");
  assert.ok(received[0].requestId);

  const forbidden = await fetch(`http://127.0.0.1:${gatewayPort}/mcp?workspace_slug=other`, {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer secret" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list", params: {} })
  });
  assert.equal(forbidden.status, 403);

  const github = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "github_get_pull_request", arguments: {} } });
  assert.equal(github.result.isError, true);
  assert.match(github.result.content[0].text, /MCP GitHub dedicado/);
});
