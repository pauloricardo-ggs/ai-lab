import assert from "node:assert/strict";
import test from "node:test";
import { diversifyEvidence, reciprocalRankFusion } from "../apps/code-mcp/src/ranking.js";

const match = (repository, file, chunk, content) => ({ repository_id: repository, file_path: file, chunk_index: chunk, content });

test("RRF favorece consenso entre estrategias sem misturar escalas de score", () => {
  const shared = match("r1", "flow.js", 0, "cancelamento contrato status");
  const semanticOnly = match("r1", "other.js", 0, "cancelamento");
  const lexicalOnly = match("r2", "handler.js", 0, "status contrato");
  const ranked = reciprocalRankFusion({ semantic: [semanticOnly, shared], lexical: [shared, lexicalOnly] }, ["cancelamento", "contrato", "status"]);
  assert.equal(ranked[0].raw.file_path, "flow.js");
  assert.deepEqual([...ranked[0].sources].sort(), ["lexical", "semantic"]);
});

test("diversificacao limita repeticao de arquivo", () => {
  const candidates = [0, 1, 2].map((chunk) => ({ raw: match("r1", "same.js", chunk, "x"), sources: new Set(["lexical"]), score: 1, termCoverage: 1 }));
  candidates.push({ raw: match("r2", "other.js", 0, "x"), sources: new Set(["semantic"]), score: 0.5, termCoverage: 1 });
  const selected = diversifyEvidence(candidates, 3, 2);
  assert.ok(selected.some((item) => item.raw.repository_id === "r2"));
  assert.ok(selected.filter((item) => item.raw.file_path === "same.js").length <= 2);
});
