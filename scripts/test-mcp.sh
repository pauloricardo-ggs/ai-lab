#!/usr/bin/env bash
set -euo pipefail

node --test tests/mcp-contracts.test.mjs tests/mcp-gateway.e2e.test.mjs tests/research-ranking.test.mjs tests/business-rules.test.mjs
node --check apps/gateway/src/index.js
node --check apps/code-mcp/src/index.js
node --check apps/git-mcp/src/index.js
node --check apps/admin/src/index.js
