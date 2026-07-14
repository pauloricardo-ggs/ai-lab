import assert from "node:assert/strict";
import test from "node:test";
import { githubRoutingHint, toolDefinition, toolNames, validateToolArguments } from "../apps/gateway/src/tools.js";

test("Gateway anuncia somente tools implementadas de codigo e Git local", () => {
  assert.equal(toolNames.length, 21);
  assert.ok(toolNames.includes("code_search_business_rules"));
  assert.ok(!toolNames.includes("git_get_pull_request"));
  assert.ok(toolNames.every((name) => !name.startsWith("knowledge_")));
});

test("todas as tools possuem contratos fechados e annotations somente leitura", () => {
  for (const name of toolNames) {
    const definition = toolDefinition(name);
    assert.equal(definition.inputSchema.additionalProperties, false, name);
    assert.equal(definition.annotations.readOnlyHint, true, name);
    assert.ok(definition.description.length > 30, name);
  }
});

test("workspace fixado sobrescreve escopo informado pelo agente", () => {
  const result = validateToolArguments("git_get_branch", { workspace_slug: "outro", workspace_id: "invalido" }, "claps");
  assert.equal(result.error, undefined);
  assert.equal(result.args.workspace_slug, "claps");
  assert.equal(result.args.workspace_id, undefined);
});

test("validacao rejeita argumentos desconhecidos e campos obrigatorios ausentes", () => {
  assert.equal(validateToolArguments("code_research_flow", { workspace_slug: "x" }).error, "invalid_arguments");
  assert.equal(validateToolArguments("git_get_branch", { workspace_slug: "x", pull_request: 42 }).error, "invalid_arguments");
  assert.equal(validateToolArguments("code_search_code", { workspace_slug: "x", query: "ok", limit: 999 }).error, "invalid_arguments");
  assert.equal(validateToolArguments("code_search_business_rules", { workspace_slug: "x", query: "ok", minimum_confidence: "alta" }).error, "invalid_arguments");
});

test("chamadas GitHub recebem orientacao acionavel", () => {
  assert.equal(githubRoutingHint("github_get_pull_request").error, "github_tool_not_available_on_code_gateway");
  assert.equal(githubRoutingHint("git_get_pull_request").error, "github_tool_not_available_on_code_gateway");
  assert.equal(githubRoutingHint("git_get_history"), null);
});
