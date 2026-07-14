import assert from "node:assert/strict";
import test from "node:test";
import { extractBusinessRules } from "../apps/admin/src/business-rules.js";

test("extrai validacao, transicao e integracao com proveniencia", () => {
  const content = `
function cancel(contract) {
  if (contract.status === "paid") {
    throw new Error("invalid status");
  }
  contract.status = "canceled";
  producer.send({ type: "ContractCanceled" });
}`;
  const file = { relativePath: "src/cancel.js", language: "javascript" };
  const symbols = [{ name: "cancel", fullName: "cancel", line: 2, endLine: 9 }];
  const rules = extractBusinessRules(content, file, symbols, "abc123");
  assert.ok(rules.some((rule) => rule.ruleType === "validation"));
  assert.ok(rules.some((rule) => rule.ruleType === "state_transition"));
  assert.ok(rules.some((rule) => rule.ruleType === "integration"));
  const flow = rules.find((rule) => rule.ruleType === "business_flow");
  assert.equal(flow?.evidenceStatus, "corroborated");
  assert.deepEqual(flow?.semantic.preconditions[0], { subject: "contract", field: "status", operator: "===", value: "paid" });
  assert.equal(flow?.semantic.effects[0].value, "canceled");
  assert.equal(flow?.semantic.consequences[0].name, "ContractCanceled");
  assert.ok(rules.every((rule) => rule.filePath === "src/cancel.js" && rule.commitSha === "abc123"));
});

test("nao confunde comparacao de estado com atribuicao", () => {
  const rules = extractBusinessRules('if (contract.status === "paid") throw new Error("invalid")', { relativePath: "src/check.js", language: "javascript" });
  assert.equal(rules.filter((rule) => rule.ruleType === "state_transition").length, 0);
});

test("nao trata documentacao como regra de codigo", () => {
  const rules = extractBusinessRules("if status === paid throw error", { relativePath: "README.md", language: "markdown" });
  assert.deepEqual(rules, []);
});
