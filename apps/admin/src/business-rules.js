const ignoredLanguages = new Set(["markdown", "text", "json", "yaml", "xml", "html", "css", "xcode"]);

function clean(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 500);
}

function nearestSymbol(symbols, line) {
  return [...symbols]
    .filter((symbol) => Number(symbol.line || 0) <= line && Number(symbol.endLine || symbol.line || 0) >= line)
    .sort((a, b) => Number(b.line || 0) - Number(a.line || 0))[0] || null;
}

function normalizeValue(value) {
  return clean(value).replace(/[;,){}]+$/g, "").replace(/^['\"]|['\"]$/g, "");
}

function describeCondition(condition) {
  if (!condition) return "uma condição identificada no código";
  const operator = { "===": "é igual a", "==": "é igual a", "!==": "é diferente de", "!=": "é diferente de", ">": "é maior que", ">=": "é maior ou igual a", "<": "é menor que", "<=": "é menor ou igual a" }[condition.operator] || condition.operator;
  return `${condition.subject || "valor"}${condition.field ? `.${condition.field}` : ""} ${operator} ${condition.value}`;
}

function conditionFromLine(line) {
  const match = String(line).match(/(?:if|unless|when)\s*\(?\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(===|==|!==|!=|>=|<=|>|<)\s*([^)&{]+?)(?:\)?\s*\{?\s*$|\s*\))/i);
  if (!match) return null;
  const path = match[1].split(".");
  return { subject: path.length > 1 ? path[0] : null, field: path.length > 1 ? path.slice(1).join(".") : path[0], operator: match[2], value: normalizeValue(match[3]) };
}

function stateFromLine(line) {
  const match = String(line).match(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.(status|state|situacao|estado)\s*=(?!=)\s*([^;\r\n]+)/i);
  if (!match) return null;
  return { subject: match[1], field: match[2], value: normalizeValue(match[3]) };
}

function integrationFromLine(line) {
  if (!/(httpClient|fetch\s*\(|axios\.|grpc|publishAsync|producer\.send|enqueue|sendAsync|postAsync|putAsync|deleteAsync|emit\s*\()/i.test(line)) return null;
  const event = String(line).match(/(?:type\s*:\s*|new\s+|publish\s*\()['\"]?([A-Z][A-Za-z0-9_]*(?:Event|Created|Updated|Canceled|Cancelled|Deleted)?)/);
  return { type: event ? "event" : "integration_call", name: event?.[1] || clean(line).slice(0, 160) };
}

function evidenceStatus(facts) {
  const types = new Set(facts.map((fact) => fact.type));
  const states = new Set(facts.filter((fact) => fact.type === "state_transition").map((fact) => fact.semantic?.effect?.value).filter(Boolean));
  if (states.size > 1) return { status: "contradicted", score: 0.45, reason: "Foram observados efeitos de estado distintos no mesmo escopo; o fluxo precisa ser tratado como ramificado." };
  if (types.has("validation") && types.has("state_transition") && types.has("integration")) return { status: "corroborated", score: 0.95, reason: "A condição, a decisão, a mudança de estado e a consequência de integração foram observadas no mesmo escopo." };
  if (types.has("validation") && types.has("state_transition")) return { status: "corroborated", score: 0.88, reason: "A condição/decisão e a mudança de estado foram observadas no mesmo escopo." };
  if (facts.length >= 2) return { status: "observed", score: 0.78, reason: "Há múltiplas evidências estruturais no mesmo escopo, sem cadeia completa." };
  return { status: "weak_evidence", score: 0.58, reason: "Há apenas uma evidência estrutural; ela não confirma uma regra completa." };
}

function makeRule({ type, statement, fact, file, symbol, commitSha, status }) {
  const evidence = clean(fact.context || fact.line);
  return {
    ruleType: type,
    statement,
    confidence: status.score,
    confidenceReason: status.reason,
    evidenceStatus: status.status,
    evidenceScore: status.score,
    evidenceCount: 1,
    filePath: file.relativePath,
    language: file.language,
    startLine: fact.lineNumber,
    endLine: fact.endLine || fact.lineNumber,
    symbolName: symbol?.fullName || symbol?.name || null,
    evidence,
    commitSha,
    reviewStatus: "proposed",
    semantic: { version: "semantic-v1", operation: symbol?.fullName || symbol?.name || null, ...fact.semantic, facts: [{ type: fact.type, line: fact.lineNumber, evidence }] },
    metadata: { extractor: "deterministic-semantic-v2", pattern: type }
  };
}

function compositeRule(facts, file, symbol, commitSha) {
  const status = evidenceStatus(facts);
  if (facts.length < 2) return null;
  const validation = facts.find((fact) => fact.type === "validation");
  const transition = facts.find((fact) => fact.type === "state_transition");
  const integration = facts.find((fact) => fact.type === "integration");
  if (!validation && !transition) return null;
  const operation = symbol?.fullName || symbol?.name || "escopo do arquivo";
  const condition = validation?.semantic?.precondition;
  const effect = transition?.semantic?.effect;
  const consequence = integration?.semantic?.consequence;
  const fragments = [];
  if (condition && validation?.semantic?.decision) fragments.push(`quando ${describeCondition(condition)}, a operação é ${validation.semantic.decision.action}`);
  if (effect) fragments.push(`no caminho permitido define ${effect.subject}.${effect.field} como ${effect.value}`);
  if (consequence) fragments.push(`${consequence.type === "event" ? "publica" : "executa integração"} ${consequence.name}`);
  const evidence = facts.map((fact) => `L${fact.lineNumber}: ${clean(fact.line)}`).join(" | ").slice(0, 1800);
  return {
    ruleType: "business_flow",
    statement: `Fluxo ${operation}: ${fragments.join("; ") || "evidências estruturais observadas no mesmo escopo"}.`,
    confidence: status.score,
    confidenceReason: status.reason,
    evidenceStatus: status.status,
    evidenceScore: status.score,
    evidenceCount: facts.length,
    filePath: file.relativePath,
    language: file.language,
    startLine: Math.min(...facts.map((fact) => fact.lineNumber)),
    endLine: Math.max(...facts.map((fact) => fact.endLine || fact.lineNumber)),
    symbolName: symbol?.fullName || symbol?.name || null,
    evidence,
    commitSha,
    reviewStatus: "proposed",
    semantic: {
      version: "semantic-v1", operation,
      subject: effect?.subject || condition?.subject || null,
      preconditions: condition ? [condition] : [],
      decisions: validation?.semantic?.decision ? [{ when: describeCondition(condition), ...validation.semantic.decision }] : [],
      effects: effect ? [effect] : [],
      consequences: consequence ? [consequence] : [],
      facts: facts.map((fact) => ({ type: fact.type, line: fact.lineNumber, evidence: clean(fact.line) }))
    },
    metadata: { extractor: "deterministic-semantic-v2", pattern: "business_flow" }
  };
}

export function extractBusinessRules(content, file, symbols = [], commitSha = null) {
  if (ignoredLanguages.has(file.language)) return [];
  const lines = String(content || "").split(/\r?\n/);
  const facts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || /^\s*(\/\/|\*|#)/.test(line)) continue;
    const context = lines.slice(index, Math.min(lines.length, index + 5)).join(" ");
    const lineNumber = index + 1;
    const condition = conditionFromLine(line);
    if (condition && /(throw|return|error|invalid|reject|fail|exception|badrequest|forbid)/i.test(context)) facts.push({ type: "validation", line, context, lineNumber, endLine: Math.min(lines.length, index + 5), semantic: { precondition: condition, decision: { action: "rejeitada", mechanism: /throw|exception/i.test(context) ? "exception" : "return_or_error" } } });
    const state = stateFromLine(line);
    if (state) facts.push({ type: "state_transition", line, context, lineNumber, semantic: { effect: state } });
    if (/(authorize|authorization|permission|forbidden|isInRole|requireRole|roles?\s*=|policy\s*=|hasPermission)/i.test(line)) facts.push({ type: "authorization", line, context, lineNumber, semantic: { decision: { action: "autorização verificada" } } });
    if (/\b(total|amount|valor|taxa|fee|discount|desconto|premium|premio|interest|juros)\b.*[+*/%-]=?|Math\.(round|floor|ceil)/i.test(line)) facts.push({ type: "calculation", line, context, lineNumber, semantic: { effect: { kind: "calculation", expression: clean(line) } } });
    const integration = integrationFromLine(line);
    if (integration) facts.push({ type: "integration", line, context, lineNumber, semantic: { consequence: integration } });
    if (/(process\.env|GetEnvironmentVariable|IConfiguration|configuration\[|feature(flag|toggle)|getenv\s*\()/i.test(line)) facts.push({ type: "configuration", line, context, lineNumber, semantic: { condition: { kind: "configuration", expression: clean(line) } } });
  }
  const rules = [];
  const grouped = new Map();
  for (const fact of facts) {
    const symbol = nearestSymbol(symbols, fact.lineNumber);
    const key = symbol?.fullName || symbol?.name || "file";
    if (!grouped.has(key)) grouped.set(key, { symbol, facts: [] });
    grouped.get(key).facts.push(fact);
    const singleStatus = evidenceStatus([fact]);
    let statement = "Evidência estrutural observada.";
    if (fact.type === "validation") statement = `Validação observada: ${describeCondition(fact.semantic.precondition)} resulta em operação rejeitada.`;
    else if (fact.type === "state_transition") statement = `Efeito de estado observado: ${fact.semantic.effect.subject}.${fact.semantic.effect.field} recebe ${fact.semantic.effect.value}.`;
    else if (fact.type === "authorization") statement = "Verificação de autorização observada.";
    else if (fact.type === "calculation") statement = `Cálculo observado: ${clean(fact.line)}`;
    else if (fact.type === "integration") statement = `Consequência de integração observada: ${fact.semantic.consequence.name}.`;
    else if (fact.type === "configuration") statement = `Comportamento condicionado por configuração: ${clean(fact.line)}`;
    rules.push(makeRule({ type: fact.type, statement, fact, file, symbol, commitSha, status: singleStatus }));
  }
  for (const { symbol, facts: symbolFacts } of grouped.values()) {
    const composite = compositeRule(symbolFacts, file, symbol, commitSha);
    if (composite) rules.push(composite);
  }
  return rules.slice(0, 500);
}
