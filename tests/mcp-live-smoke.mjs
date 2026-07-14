import fs from "node:fs";

function localEnv() {
  const values = {};
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    values[line.slice(0, index)] = line.slice(index + 1).replace(/^['"]|['"]$/g, "");
  }
  return values;
}

const fileEnv = localEnv();
const workspace = process.env.MCP_WORKSPACE_SLUG;
const repositoryId = process.env.MCP_REPOSITORY_ID;
const port = process.env.MCP_GATEWAY_PORT || fileEnv.MCP_GATEWAY_PORT || "7000";
const url = process.env.MCP_URL || `http://127.0.0.1:${port}/mcp`;
const apiKey = process.env.GATEWAY_API_KEY || fileEnv.GATEWAY_API_KEY || "";
if (!workspace || !repositoryId) throw new Error("MCP_WORKSPACE_SLUG_and_MCP_REPOSITORY_ID_are_required");

let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(120_000)
  });
  if (!response.ok) throw new Error(`gateway_http_${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}:${body.error.message}`);
  return body.result;
}

const base = { workspace_slug: workspace, repository_id: repositoryId };
const calls = [
  ["code_search_code", { ...base, query: "class status", limit: 3 }],
  ["code_semantic_search_code", { ...base, query: "fluxo principal e regras de status", limit: 3 }],
  ["code_search_symbol", { ...base, symbol: "Program", limit: 3 }],
  ["code_get_class", { ...base, symbol: "Program", limit: 3 }],
  ["code_get_method", { ...base, symbol: "Main", limit: 3 }],
  ["code_find_references", { ...base, symbol: "Program", limit: 3 }],
  ["code_find_callers", { ...base, symbol: "Main", limit: 3 }],
  ["code_find_callees", { ...base, symbol: "Main", limit: 3 }],
  ["code_find_dependencies", { ...base, symbol: "System", limit: 3 }],
  ["code_explain_architecture", base],
  ["code_analyze_impact", { ...base, symbol: "Program", limit: 10 }],
  ["code_search_business_rules", { ...base, query: "status validacao", limit: 3 }],
  ["git_get_commit", { ...base, commit: "HEAD" }],
  ["git_get_history", { ...base, limit: 3 }],
  ["git_get_diff", { ...base, from: "HEAD^", to: "HEAD", context: 1 }],
  ["git_get_branch", base],
  ["git_list_changed_files", { ...base, from: "HEAD^", to: "HEAD" }],
  ["git_find_commits_touching_symbol", { ...base, symbol: "class", limit: 3 }],
  ["git_search_commit_message", { ...base, query: "feat", limit: 3 }]
];

const initialized = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "live-smoke", version: "1" } });
if (initialized.serverInfo?.name !== "ai-code-platform") throw new Error("unexpected_server");
const listed = await rpc("tools/list", {});
if (listed.tools?.length !== 21) throw new Error(`unexpected_tool_count_${listed.tools?.length}`);

const failures = [];
for (const [name, argumentsValue] of calls) {
  const result = await rpc("tools/call", { name, arguments: argumentsValue });
  if (result.isError) failures.push(`${name}: ${result.content?.[0]?.text || "unknown_error"}`);
  else console.log(`ok ${name}`);
}

const research = await rpc("tools/call", { name: "code_research_flow", arguments: { ...base, question: "Como funciona o fluxo principal e as regras de status?", candidate_limit: 10, evidence_limit: 3 } });
if (research.isError) failures.push(`code_research_flow: ${research.content?.[0]?.text}`);
else {
  console.log("ok code_research_flow");
  const payload = JSON.parse(research.content[0].text);
  const researchId = payload.research?.research_id;
  const continued = await rpc("tools/call", { name: "code_research_continue", arguments: { ...base, research_id: researchId, focus: "status", candidate_limit: 10, evidence_limit: 3 } });
  if (continued.isError) failures.push(`code_research_continue: ${continued.content?.[0]?.text}`);
  else console.log("ok code_research_continue");
}

if (failures.length) throw new Error(`live_smoke_failed\n${failures.join("\n")}`);
console.log(`live MCP smoke: ${listed.tools.length} tools validadas`);
