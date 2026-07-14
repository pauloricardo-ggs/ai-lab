const state = {
  services: [],
  containers: [],
  workspaces: [],
  selectedWorkspace: null,
  mcp: { tools: [], base_url: "" },
  mcpIntegrationTab: "ide",
  mcpSkill: { selectedSlugs: new Set(), content: "", name: "" },
  openWebUiPrompt: { content: "", mcpUrl: "" },
  remoteRepos: [],
  repoSourceMode: "github",
  expandedIndexJobs: new Set(),
  indexReport: null,
  repositoryExplorer: { data: null, tab: "overview" },
  logs: { entries: [], latestId: 0, retained: 0 },
  indexJobs: {
    running: [],
    history: [],
    page: 1,
    limit: 6,
    total: 0,
    totalPages: 1,
    queue: { paused: false, max_concurrent_repositories: 1 }
  }
};

const els = {
  pageTitle: document.querySelector("#pageTitle"),
  globalStatus: document.querySelector("#globalStatus"),
  serviceGrid: document.querySelector("#serviceGrid"),
  containerList: document.querySelector("#containerList"),
  containerSummary: document.querySelector("#containerSummary"),
  onlineCount: document.querySelector("#onlineCount"),
  workspaceCount: document.querySelector("#workspaceCount"),
  repoCount: document.querySelector("#repoCount"),
  refreshButton: document.querySelector("#refreshButton"),
  adminKey: document.querySelector("#adminKey"),
  saveAdminKey: document.querySelector("#saveAdminKey"),
  workspaceForm: document.querySelector("#workspaceForm"),
  newWorkspaceButton: document.querySelector("#newWorkspaceButton"),
  workspaceName: document.querySelector("#workspaceName"),
  workspaceSlug: document.querySelector("#workspaceSlug"),
  workspaceDescription: document.querySelector("#workspaceDescription"),
  workspaceList: document.querySelector("#workspaceList"),
  adminWorkspaceListScreen: document.querySelector("#adminWorkspaceListScreen"),
  workspaceDetailScreen: document.querySelector("#workspaceDetailScreen"),
  backToWorkspaces: document.querySelector("#backToWorkspaces"),
  selectedWorkspaceTitle: document.querySelector("#selectedWorkspaceTitle"),
  selectedWorkspaceSlug: document.querySelector("#selectedWorkspaceSlug"),
  workspaceDetailRepoCount: document.querySelector("#workspaceDetailRepoCount"),
  repoEmptyState: document.querySelector("#repoEmptyState"),
  repoManager: document.querySelector("#repoManager"),
  repoList: document.querySelector("#repoList"),
  repoForm: document.querySelector("#repoForm"),
  repoModal: document.querySelector("#repoModal"),
  openRepoModal: document.querySelector("#openRepoModal"),
  closeRepoModal: document.querySelector("#closeRepoModal"),
  cancelRepoModal: document.querySelector("#cancelRepoModal"),
  repoName: document.querySelector("#repoName"),
  repoUrl: document.querySelector("#repoUrl"),
  repoBranch: document.querySelector("#repoBranch"),
  repositoryExplorer: document.querySelector("#repositoryExplorer"),
  backToRepositories: document.querySelector("#backToRepositories"),
  repositoryExplorerId: document.querySelector("#repositoryExplorerId"),
  repositoryExplorerTitle: document.querySelector("#repositoryExplorerTitle"),
  repositoryExplorerSubtitle: document.querySelector("#repositoryExplorerSubtitle"),
  repositoryExplorerStatus: document.querySelector("#repositoryExplorerStatus"),
  repositoryExplorerTabs: document.querySelector("#repositoryExplorerTabs"),
  repositoryExplorerBody: document.querySelector("#repositoryExplorerBody"),
  githubRepoSearch: document.querySelector("#githubRepoSearch"),
  loadGithubRepos: document.querySelector("#loadGithubRepos"),
  remoteRepoSelect: document.querySelector("#remoteRepoSelect"),
  githubRepoSource: document.querySelector("#githubRepoSource"),
  manualRepoSource: document.querySelector("#manualRepoSource"),
  indexSummary: document.querySelector("#indexSummary"),
  indexRunningList: document.querySelector("#indexRunningList"),
  indexHistorySummary: document.querySelector("#indexHistorySummary"),
  indexHistoryList: document.querySelector("#indexHistoryList"),
  indexPagination: document.querySelector("#indexPagination"),
  queueControls: document.querySelector("#queueControls"),
  graphCanvas: document.querySelector("#graphCanvas"),
  graphInspector: document.querySelector("#graphInspector"),
  graphTypeFilter: document.querySelector("#graphTypeFilter"),
  graphWorkspace: document.querySelector("#graphWorkspace"),
  graphSearch: document.querySelector("#graphSearch"),
  graphLimit: document.querySelector("#graphLimit"),
  graphStats: document.querySelector("#graphStats"),
  reloadGraph: document.querySelector("#reloadGraph"),
  openWorkspaceGraph: document.querySelector("#openWorkspaceGraph"),
  operationalLogs: document.querySelector("#operationalLogs"),
  logsLevel: document.querySelector("#logsLevel"),
  logsComponent: document.querySelector("#logsComponent"),
  logsSearch: document.querySelector("#logsSearch"),
  logsSummary: document.querySelector("#logsSummary"),
  logsConnectionStatus: document.querySelector("#logsConnectionStatus"),
  clearVisibleLogs: document.querySelector("#clearVisibleLogs"),
  mcpStatus: document.querySelector("#mcpStatus"),
  mcpBaseUrl: document.querySelector("#mcpBaseUrl"),
  mcpConfigExample: document.querySelector("#mcpConfigExample"),
  toolList: document.querySelector("#toolList"),
  mcpSkillWorkspaceList: document.querySelector("#mcpSkillWorkspaceList"),
  mcpSkillSummary: document.querySelector("#mcpSkillSummary"),
  openWebUiWorkspaceList: document.querySelector("#openWebUiWorkspaceList"),
  openWebUiWorkspaceSummary: document.querySelector("#openWebUiWorkspaceSummary"),
  openWebUiEndpointTemplate: document.querySelector("#openWebUiEndpointTemplate"),
  generateMcpSkill: document.querySelector("#generateMcpSkill"),
  copyMcpSkill: document.querySelector("#copyMcpSkill"),
  mcpSkillOutput: document.querySelector("#mcpSkillOutput"),
  mcpSkillFilename: document.querySelector("#mcpSkillFilename"),
  mcpSkillContent: document.querySelector("#mcpSkillContent"),
  generateOpenWebUiPrompt: document.querySelector("#generateOpenWebUiPrompt"),
  openWebUiPromptOutput: document.querySelector("#openWebUiPromptOutput"),
  openWebUiPromptContent: document.querySelector("#openWebUiPromptContent"),
  openWebUiMcpUrl: document.querySelector("#openWebUiMcpUrl"),
  copyOpenWebUiPrompt: document.querySelector("#copyOpenWebUiPrompt"),
  toast: document.querySelector("#toast")
};

function adminHeaders() {
  const key = localStorage.getItem("adminApiKey") || "";
  return key ? { "x-admin-api-key": key } : {};
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...adminHeaders(),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(body.error || `request_failed_${response.status}`);
    error.body = body;
    throw error;
  }

  return body;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => els.toast.classList.add("hidden"), 4200);
}

function setStatus(el, online) {
  el.classList.remove("online", "offline", "warning", "muted");
  el.classList.add(online ? "online" : "offline");
  el.textContent = online ? "Online" : "Offline";
}

function routeTo(route) {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelectorAll(".nav a").forEach((link) => link.classList.remove("active"));

  const view = document.querySelector(`#view-${route}`);
  if (view) {
    view.classList.add("active");
  }

  const nav = document.querySelector(`.nav a[data-route="${route}"]`);
  if (nav) {
    nav.classList.add("active");
  }

  const titles = {
    dashboard: "Visão geral",
    admin: "Workspaces",
    graph: "Explorador do grafo",
    logs: "Logs operacionais",
    mcp: "MCP Gateway"
  };
  els.pageTitle.textContent = titles[route] || "Dashboard";

  const path = route === "dashboard" ? "/" : route === "mcp" ? "/services/mcp-gateway" : route === "graph" ? "/graph" : route === "logs" ? "/logs" : "/admin";
  if (window.location.pathname !== path) {
    history.pushState({ route }, "", path);
  }
}

function routeFromPath() {
  if (window.location.pathname.startsWith("/logs")) return "logs";
  if (window.location.pathname.startsWith("/graph")) return "graph";
  if (window.location.pathname.startsWith("/admin")) {
    return "admin";
  }
  if (window.location.pathname.startsWith("/services/mcp-gateway")) {
    return "mcp";
  }
  return "dashboard";
}

function renderServices() {
  const online = state.services.filter((service) => service.online).length;
  els.onlineCount.textContent = String(online);
  els.globalStatus.textContent = `${online}/${state.services.length} servicos online`;
  els.globalStatus.classList.toggle("online", online === state.services.length);
  els.globalStatus.classList.toggle("warning", online > 0 && online < state.services.length);
  els.globalStatus.classList.toggle("offline", online === 0);

  els.serviceGrid.innerHTML = state.services.map((service) => `
    <article class="service-card" data-service="${service.id}">
      <div>
        <span class="service-icon">${service.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
        <h3>${escapeHtml(service.name)}</h3>
        <p>${escapeHtml(service.description)}</p>
      </div>
      <footer>
        <span class="status-pill ${service.online ? "online" : "offline"}">${service.online ? "Online" : "Offline"}</span>
        <button class="secondary-button" data-open-service="${service.id}" ${service.can_open ? "" : "disabled"}>${service.can_open ? service.kind === "api" ? "Console" : "Abrir" : "Interno"}</button>
      </footer>
    </article>
  `).join("");
}

function renderContainers(error) {
  if (error) {
    els.containerSummary.textContent = "Docker indisponivel";
    els.containerSummary.className = "status-pill offline";
    els.containerList.innerHTML = `<div class="empty-state">Nao foi possivel ler o Docker socket: ${escapeHtml(error)}</div>`;
    return;
  }

  const running = state.containers.filter((container) => container.state === "running").length;
  els.containerSummary.textContent = `${running}/${state.containers.length} em execucao`;
  els.containerSummary.className = `status-pill ${running === state.containers.length ? "online" : running > 0 ? "warning" : "offline"}`;

  if (!state.containers.length) {
    els.containerList.innerHTML = `<div class="empty-state">Nenhum container da plataforma encontrado.</div>`;
    return;
  }

  els.containerList.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Container</th>
          <th>Estado</th>
          <th>Imagem</th>
          <th>Portas</th>
        </tr>
      </thead>
      <tbody>
        ${state.containers.map((container) => `
          <tr>
            <td><strong>${escapeHtml(container.name)}</strong><br><span class="muted-text">${escapeHtml(container.status)}</span></td>
            <td><span class="status-pill ${container.state === "running" ? "online" : container.state === "exited" ? "offline" : "warning"}">${escapeHtml(container.state)}</span></td>
            <td><code>${escapeHtml(container.image)}</code></td>
            <td>${renderPorts(container.ports)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderPorts(ports) {
  const published = (ports || [])
    .filter((port) => port.PublicPort)
    .map((port) => `${port.PublicPort}:${port.PrivatePort}/${port.Type}`);

  return published.length ? published.map((port) => `<code>${escapeHtml(port)}</code>`).join("<br>") : "-";
}

function renderWorkspaces() {
  const repoTotal = state.workspaces.reduce((sum, workspace) => sum + Number(workspace.repository_count || 0), 0);
  els.workspaceCount.textContent = String(state.workspaces.length);
  els.repoCount.textContent = String(repoTotal);

  if (!state.workspaces.length) {
    els.workspaceList.innerHTML = `<div class="empty-state">Nenhum workspace criado ainda.</div>`;
  } else {
    els.workspaceList.innerHTML = state.workspaces.map((workspace) => `
      <article class="workspace-item ${state.selectedWorkspace?.id === workspace.id ? "active" : ""}" data-workspace="${workspace.slug}">
        <strong>${escapeHtml(workspace.name)}</strong>
        <span>${escapeHtml(workspace.slug)} · ${workspace.repository_count || 0} repos</span>
        ${workspace.description ? `<p>${escapeHtml(workspace.description)}</p>` : ""}
      </article>
    `).join("");
  }

}

function resetIndexJobState() {
  state.indexJobs = {
    running: [],
    history: [],
    page: 1,
    limit: state.indexJobs?.limit || 6,
    total: 0,
    totalPages: 1,
    queue: state.indexJobs?.queue || { paused: false, max_concurrent_repositories: 1 }
  };
}

function resetIndexReport() {
  state.indexReport = null;
  state.repositoryExplorer = { data: null, tab: "overview" };
  els.repositoryExplorer?.classList.add("hidden");
  els.repositoryExplorerBody && (els.repositoryExplorerBody.innerHTML = "");
}

function showWorkspaceListScreen() {
  state.selectedWorkspace = null;
  resetIndexJobState();
  resetIndexReport();
  els.adminWorkspaceListScreen.classList.remove("hidden");
  els.workspaceDetailScreen.classList.add("hidden");
  renderWorkspaces();
}

function showWorkspaceDetailScreen() {
  els.adminWorkspaceListScreen.classList.add("hidden");
  els.workspaceDetailScreen.classList.remove("hidden");
}

function showRepositoryList() {
  state.repositoryExplorer = { data: null, tab: "overview" };
  els.repositoryExplorer.classList.add("hidden");
  els.repoManager.classList.remove("hidden");
}

function renderRepositories(payload) {
  if (!payload || !state.selectedWorkspace) {
    els.repoEmptyState.classList.remove("hidden");
    els.repoManager.classList.add("hidden");
    resetIndexJobState();
    renderIndexJobs();
    return;
  }

  els.repoEmptyState.classList.add("hidden");
  els.repoManager.classList.remove("hidden");
  els.selectedWorkspaceTitle.textContent = state.selectedWorkspace.name;
  els.selectedWorkspaceSlug.textContent = state.selectedWorkspace.slug;

  if (state.repositoryExplorer.data) {
    els.repoManager.classList.add("hidden");
    return;
  }

  const repos = payload.repositories || [];
  els.workspaceDetailRepoCount.textContent = `${repos.length} repos`;
  if (!repos.length) {
    els.repoList.innerHTML = `<div class="empty-state">Nenhum repositorio nesse workspace.</div>`;
    return;
  }

  const activeRepositoryIds = new Set((state.indexJobs.running || []).map((job) => job.repository_id));
  els.repoList.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Repositorio</th>
          <th>Status</th>
          <th>Branch</th>
          <th>Path</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${repos.map((repo) => {
          const indexActive = activeRepositoryIds.has(repo.id) || repo.status === "indexing";
          return `
            <tr>
              <td>
                <button class="repo-explorer-name" data-open-repository-explorer="${repo.id}" type="button">${escapeHtml(repo.name)}</button><br>
                <small class="muted-text">ID: <code>${escapeHtml(repo.id)}</code></small><br>
                <span class="muted-text">${escapeHtml(repo.url)}</span>
              </td>
              <td><span class="status-pill ${["active", "indexed"].includes(repo.status) ? "online" : ["error", "index_error", "index_canceled"].includes(repo.status) ? "offline" : "warning"}">${escapeHtml(repo.status)}</span></td>
              <td>${escapeHtml(repo.default_branch || "-")}</td>
              <td><code>${escapeHtml(repo.local_path || "-")}</code></td>
              <td>
                <button class="secondary-button" data-open-repository-explorer="${repo.id}">Explorar</button>
                <button class="secondary-button" data-reindex-repo="${repo.id}" ${indexActive ? "disabled" : ""}>${indexActive ? "Indexando" : "Reindexar"}</button>
                <button class="danger-button" data-delete-repo="${repo.id}" ${indexActive ? "disabled" : ""}>Remover</button>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderIndexReport(report) {
  if (!report || !els.repositoryExplorerBody) return;

  const summary = report.summary || {};
  const indexed = Number(summary.indexed || 0);
  const skipped = Number(summary.skipped || 0);
  const errors = Number(summary.errors || 0);
  const total = Number(summary.total || 0);
  const explorerStats = report.explorer?.stats || {};
  const score = total ? Math.round((indexed / total) * 100) : 0;
  const symbols = sumCounts(report.symbols_by_type);
  const relationships = sumCounts(report.relationships_by_type);
  const unresolved = Number((report.relationships_by_resolution || []).find((row) => row.status === "unresolved")?.count || 0);
  const resolved = Math.max(relationships - unresolved, 0);
  const resolutionRate = relationships ? Math.round((resolved / relationships) * 100) : 100;
  const qualityLabel = errors ? "Ação necessária" : skipped ? "Índice saudável com ressalvas" : indexed ? "Índice saudável" : "Sem dados indexados";
  const qualityDescription = errors
    ? `${errors} arquivo(s) falharam. Revise os problemas antes de confiar integralmente nas buscas.`
    : skipped
      ? `${skipped} arquivo(s) foram ignorados pelas regras de indexação. Isso pode ser esperado.`
      : "Todos os arquivos elegíveis foram processados sem erros registrados.";

  els.repositoryExplorerBody.innerHTML = `
    <div class="quality-score">
      <div class="score-ring" style="--score:${score}"><strong>${score}%</strong></div>
      <div><span class="section-kicker">Cobertura do índice</span><h3>${qualityLabel}</h3><p>${qualityDescription} Taxa de resolução das relações: ${resolutionRate}%.</p></div>
    </div>
    <div class="quality-grid">
      ${metricCard("Arquivos", total)}
      ${metricCard("Indexados", indexed)}
      ${metricCard("Ignorados", skipped)}
      ${metricCard("Erros", errors)}
      ${metricCard("Símbolos", symbols)}
      ${metricCard("Relações", relationships)}
      ${metricCard("Chunks", explorerStats.chunks)}
      ${metricCard("Regras", explorerStats.rules)}
      ${metricCard("Resolvidas", resolved)}
      ${metricCard("Não resolvidas", unresolved)}
    </div>
    <div class="explorer-sources">
      ${explorerStatus("PostgreSQL", `${total} arquivos · ${Number(explorerStats.chunks || 0)} chunks · ${Number(explorerStats.symbols || symbols)} símbolos`)}
      ${explorerStatus("Qdrant", report.explorer?.qdrant?.available ? `${report.explorer.qdrant.points} vetores em ${report.explorer.qdrant.collection}` : report.explorer?.qdrant?.error || "indisponível", report.explorer?.qdrant?.available)}
      ${explorerStatus("Neo4j", report.explorer?.graph?.available ? `${report.explorer.graph.files} arquivos · ${report.explorer.graph.symbols} símbolos` : report.explorer?.graph?.error || "indisponível", report.explorer?.graph?.available)}
    </div>
    ${renderLatestReportRun(report.latest_job)}
    <div class="quality-columns">
      ${languageCoverageTable("Arquivos por linguagem", report.files_by_language)}
      ${reportTable("Simbolos por linguagem", report.symbols_by_language, "language")}
      ${reportTable("Simbolos por tipo", report.symbols_by_type, "type")}
      ${reportTable("Relacoes por tipo", report.relationships_by_type, "type")}
      ${reportTable("Resolucao de relacoes", report.relationships_by_resolution, "status")}
      ${reportTable("Regras observadas por tipo", report.business_rules_by_type, "type")}
      ${reportTable("Status automático das regras", report.business_rules_by_review, "status")}
      ${relationshipLanguageTable("Relacoes por linguagem", report.relationships_by_language)}
      ${reportTable("Ignorados por motivo", report.ignored_reasons, "reason")}
    </div>
    <div class="quality-issues">
      <h4>Arquivos ignorados ou com erro</h4>
      ${renderFileIssues(report.file_issues || [])}
    </div>
  `;
}

function renderLatestReportRun(job) {
  if (!job) return "";
  const telemetry = liveTelemetry(job);
  return `
    <div class="report-run-summary">
      <div><span>Última execução</span><strong>${formatDateTime(job.finished_at || job.started_at || job.created_at)}</strong></div>
      <div><span>Status</span><strong>${escapeHtml(jobStatusLabel(job.status))}</strong></div>
      <div><span>Duração</span><strong>${formatDuration(telemetry.elapsedMs)}</strong></div>
      <div><span>Arquivos</span><strong>${Number(job.files_indexed || 0)}</strong></div>
      <div><span>Chunks</span><strong>${Number(job.chunks_indexed || 0)}</strong></div>
      <div><span>Taxa média</span><strong>${formatRate(telemetry.filesPerMinute, "arq/min")}</strong></div>
    </div>
  `;
}

function metricCard(label, value) {
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${Number(value || 0)}</strong>
    </div>
  `;
}

function explorerTable(title, columns, rows = []) {
  return `<section class="panel explorer-table"><div class="panel-header"><div><span class="section-kicker">PostgreSQL</span><h3>${escapeHtml(title)}</h3></div><span class="muted-text">${rows.length} exibidos</span></div>${rows.length ? `<div class="table-wrap"><table><thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${column.code ? `<code>${escapeHtml(String(row[column.key] ?? "-"))}</code>` : escapeHtml(String(row[column.key] ?? "-"))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<div class="empty-state">Sem dados indexados.</div>`}</section>`;
}

function explorerStatus(label, detail, available = true) {
  return `<div class="explorer-source ${available ? "" : "unavailable"}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(detail))}</strong></div>`;
}

function renderRepositoryExplorer() {
  const data = state.repositoryExplorer.data;
  if (!data) return;
  const repo = data.repository;
  const summary = data.summary || {};
  const explorer = data.explorer || {};
  const tabs = [["overview", "Visão geral"], ["data", "Dados"], ["collections", "Coleções e grafo"], ["rules", "Regras"]];
  const errors = Number(summary.errors || 0);
  const statusClass = errors ? "offline" : repo.status === "indexed" || repo.status === "active" ? "online" : "warning";
  els.repositoryExplorer.classList.remove("hidden");
  els.repoManager.classList.add("hidden");
  els.repositoryExplorerId.textContent = repo.id;
  els.repositoryExplorerTitle.textContent = repo.name;
  els.repositoryExplorerSubtitle.textContent = `${repo.url || "Sem URL"} · branch ${repo.default_branch || "-"}`;
  els.repositoryExplorerStatus.textContent = repo.status;
  els.repositoryExplorerStatus.className = `status-pill ${statusClass}`;
  els.repositoryExplorerTabs.innerHTML = tabs.map(([key, label]) => `<button class="explorer-tab ${state.repositoryExplorer.tab === key ? "active" : ""}" data-explorer-tab="${key}" role="tab" aria-selected="${state.repositoryExplorer.tab === key}">${label}</button>`).join("");

  if (state.repositoryExplorer.tab === "overview") {
    renderIndexReport(data);
    return;
  }
  const sourceSummary = state.repositoryExplorer.tab === "collections" ? `<section class="panel explorer-overview"><div class="explorer-sources">${explorerStatus("Qdrant · coleção", explorer.qdrant?.collection || "code_symbols", explorer.qdrant?.available)}${explorerStatus("Qdrant · vetores deste repositório", explorer.qdrant?.available ? explorer.qdrant.points : explorer.qdrant?.error || "indisponível", explorer.qdrant?.available)}${explorerStatus("Neo4j · arquivos", explorer.graph?.available ? explorer.graph.files : explorer.graph?.error || "indisponível", explorer.graph?.available)}${explorerStatus("Neo4j · símbolos", explorer.graph?.available ? explorer.graph.symbols : explorer.graph?.error || "indisponível", explorer.graph?.available)}</div></section>` : "";
  els.repositoryExplorerBody.innerHTML = `${sourceSummary}${renderExplorerDataset(explorer.dataset, state.repositoryExplorer.tab)}`;
}

function semanticList(title, values, formatter) {
  const entries = Array.isArray(values) ? values : [];
  return `<div class="semantic-list"><span>${escapeHtml(title)}</span>${entries.length ? `<ul>${entries.map((entry) => `<li>${escapeHtml(formatter(entry))}</li>`).join("")}</ul>` : `<em>Não identificado</em>`}</div>`;
}

function renderSemanticRuleCard(rule) {
  const semantic = rule.semantic || {};
  const preconditions = semantic.preconditions || (semantic.precondition ? [semantic.precondition] : []);
  const decisions = semantic.decisions || (semantic.decision ? [semantic.decision] : []);
  const effects = semantic.effects || (semantic.effect ? [semantic.effect] : []);
  const consequences = semantic.consequences || (semantic.consequence ? [semantic.consequence] : []);
  const status = rule.evidence_status || "observed";
  const score = Math.round(Number(rule.evidence_score ?? rule.confidence ?? 0) * 100);
  return `<article class="panel rule-card"><div class="panel-header"><div><span class="section-kicker">${escapeHtml(rule.rule_type)} · ${escapeHtml(status)}</span><h3>${escapeHtml(rule.statement)}</h3></div><span class="status-pill ${status === "corroborated" ? "online" : status === "contradicted" ? "offline" : "warning"}">${score}%</span></div><div class="semantic-grid">${semanticList("Pré-condições", preconditions, (item) => `${item.subject || "valor"}${item.field ? `.${item.field}` : ""} ${item.operator || ""} ${item.value || ""}`)}${semanticList("Decisões", decisions, (item) => item.action || JSON.stringify(item))}${semanticList("Efeitos", effects, (item) => `${item.subject || ""}${item.field ? `.${item.field}` : ""}${item.value ? ` = ${item.value}` : item.expression ? `: ${item.expression}` : ""}`)}${semanticList("Consequências", consequences, (item) => item.name || item.type || JSON.stringify(item))}</div><p>${escapeHtml(rule.confidence_reason || "Evidência estrutural observada no código.")}</p><details class="rule-evidence"><summary>${Number(rule.evidence_count || 1)} evidência(s) · ${escapeHtml(rule.file_path)}:${Number(rule.start_line || 0)}</summary><pre>${escapeHtml(rule.evidence || "")}</pre></details><div class="rule-meta"><code>${escapeHtml(rule.symbol_name || semantic.operation || "sem símbolo")}</code><span>commit ${escapeHtml(rule.indexed_commit_sha || "não informado")}</span></div></article>`;
}

function renderExplorerDataset(dataset, tab) {
  const available = tab === "data" ? [["files", "Arquivos"], ["symbols", "Símbolos"], ["relationships", "Relações"]] : tab === "collections" ? [["chunks", "Chunks"]] : [["rules", "Regras"]];
  if (!dataset) return `<div class="empty-state">Carregando dados do repositório…</div>`;
  const labels = { files: "Arquivos", chunks: "Chunks", symbols: "Símbolos", relationships: "Relações", rules: "Regras" };
  const columns = {
    files: [["file_path", "Arquivo"], ["language", "Linguagem"], ["status", "Status"], ["size_bytes", "Bytes"]],
    chunks: [["file_path", "Arquivo"], ["chunk_index", "Chunk"], ["start_line", "Início"], ["end_line", "Fim"], ["content", "Conteúdo"]],
    symbols: [["name", "Nome"], ["symbol_type", "Tipo"], ["file_path", "Arquivo"], ["start_line", "Linha"]],
    relationships: [["relationship_type", "Tipo"], ["source_name", "Origem"], ["target_name", "Destino"], ["resolution_status", "Resolução"]],
    rules: [["rule_type", "Tipo"], ["statement", "Regra"], ["confidence", "Confiança"], ["file_path", "Arquivo"]]
  }[dataset.dataset] || [];
  const renderValue = (row, key) => key === "content" ? `<details class="chunk-content"><summary>${escapeHtml(String(row.content || "").slice(0, 140))}${String(row.content || "").length > 140 ? "…" : ""}</summary><pre>${escapeHtml(row.content || "")}</pre></details>` : key === "file_path" ? `<code>${escapeHtml(String(row[key] ?? "-"))}</code>` : escapeHtml(String(row[key] ?? "-"));
  const content = dataset.dataset === "rules"
    ? `<section class="explorer-rules">${dataset.rows.map(renderSemanticRuleCard).join("")}</section>`
    : dataset.rows.length ? `<div class="table-wrap"><table><thead><tr>${columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}</tr></thead><tbody>${dataset.rows.map((row) => `<tr>${columns.map(([key]) => `<td>${renderValue(row, key)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<div class="empty-state">Nenhum registro encontrado.</div>`;
  return `<section class="panel explorer-table"><div class="panel-header"><div><span class="section-kicker">Dados indexados</span><h3>${labels[dataset.dataset] || "Dados"} · ${dataset.total} no total</h3></div><span class="muted-text">Página ${dataset.page} de ${dataset.total_pages}</span></div><div class="explorer-data-controls"><div class="explorer-dataset-tabs">${available.map(([key, label]) => `<button class="explorer-tab ${dataset.dataset === key ? "active" : ""}" data-explorer-dataset="${key}">${label}</button>`).join("")}</div><input id="explorerDatasetSearch" value="${escapeHtml(dataset.search || "")}" placeholder="Buscar por nome, arquivo${dataset.dataset === "chunks" ? ", palavra ou frase" : ""}"><button class="secondary-button" data-explorer-search>Buscar</button></div>${content}<div class="pagination"><button class="secondary-button small-button" data-explorer-page="${dataset.page - 1}" ${dataset.page <= 1 ? "disabled" : ""}>Anterior</button><span>${dataset.total} registros · página ${dataset.page}/${dataset.total_pages}</span><button class="secondary-button small-button" data-explorer-page="${dataset.page + 1}" ${dataset.page >= dataset.total_pages ? "disabled" : ""}>Próxima</button></div></section>`;
}

async function loadExplorerDataset(dataset, page = 1, search = "") {
  const current = state.repositoryExplorer.data;
  if (!current || !state.selectedWorkspace) return;
  const params = new URLSearchParams({ dataset, page: String(page), limit: "50" });
  if (search.trim()) params.set("search", search.trim());
  const data = await api(`/api/workspaces/${encodeURIComponent(state.selectedWorkspace.slug)}/repositories/${encodeURIComponent(current.repository.id)}/explorer?${params}`);
  state.indexReport = data;
  state.repositoryExplorer.data = data;
  renderRepositoryExplorer();
}

function sumCounts(rows = []) {
  return rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
}

function reportTable(title, rows = [], labelKey) {
  return `
    <div class="quality-table">
      <h4>${escapeHtml(title)}</h4>
      ${rows.length ? `
        <table>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row[labelKey] || "-")}</td>
                <td><strong>${Number(row.count || 0)}</strong></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<div class="empty-state">Sem dados.</div>`}
    </div>
  `;
}

function languageCoverageTable(title, rows = []) {
  return `
    <div class="quality-table">
      <h4>${escapeHtml(title)}</h4>
      ${rows.length ? `
        <table>
          <thead>
            <tr>
              <th>Linguagem</th>
              <th>Total</th>
              <th>Ok</th>
              <th>Skip</th>
              <th>Erro</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.language || "-")}</td>
                <td><strong>${Number(row.total || 0)}</strong></td>
                <td>${Number(row.indexed || 0)}</td>
                <td>${Number(row.skipped || 0)}</td>
                <td>${Number(row.errors || 0)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<div class="empty-state">Sem dados.</div>`}
    </div>
  `;
}

function relationshipLanguageTable(title, rows = []) {
  return `
    <div class="quality-table">
      <h4>${escapeHtml(title)}</h4>
      ${rows.length ? `
        <table>
          <thead>
            <tr>
              <th>Linguagem</th>
              <th>Total</th>
              <th>Resolvidas</th>
              <th>Pendentes</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.language || "-")}</td>
                <td><strong>${Number(row.total || 0)}</strong></td>
                <td>${Number(row.resolved || 0)}</td>
                <td>${Number(row.unresolved || 0)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<div class="empty-state">Sem dados.</div>`}
    </div>
  `;
}

function renderFileIssues(issues) {
  if (!issues.length) {
    return `<div class="empty-state">Nenhum arquivo ignorado ou com erro registrado.</div>`;
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Arquivo</th>
            <th>Status</th>
            <th>Motivo/erro</th>
          </tr>
        </thead>
        <tbody>
          ${issues.map((issue) => `
            <tr>
              <td><code>${escapeHtml(issue.file_path)}</code><br><span class="muted-text">${escapeHtml(issue.language || "-")}</span></td>
              <td><span class="status-pill ${issue.status === "error" ? "offline" : "warning"}">${escapeHtml(issue.status)}</span></td>
              <td>${escapeHtml(issue.error || issue.skipped_reason || formatChunkFailures(issue.metadata) || "-")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function formatChunkFailures(metadata) {
  const failures = metadata?.failed_chunks;
  if (!Array.isArray(failures) || !failures.length) return "";
  return `${failures.length} chunk(s) com falha: ${failures.map((item) => `#${item.index} ${item.error}`).join("; ")}`;
}

function renderIndexJobs(error) {
  if (!els.indexSummary || !els.indexRunningList || !els.indexHistoryList || !els.indexPagination) {
    return;
  }

  if (error) {
    els.indexSummary.textContent = "Erro";
    els.indexSummary.className = "status-pill offline";
    els.indexRunningList.innerHTML = `<div class="empty-state">Nao foi possivel carregar o progresso: ${escapeHtml(error)}</div>`;
    els.indexHistoryList.innerHTML = "";
    els.indexPagination.innerHTML = "";
    return;
  }

  if (els.queueControls) {
    const queue = state.indexJobs.queue || {};
    const concurrencySelect = els.queueControls.querySelector("[data-queue-concurrency]");
    // O polling atualiza as estatisticas a cada dois segundos. Recriar o select
    // enquanto ele esta aberto cancela a escolha do usuario.
    if (document.activeElement !== concurrencySelect) {
      els.queueControls.innerHTML = `<span class="muted-text">Fila ${queue.paused ? "pausada" : "ativa"} · concorrencia</span><select data-queue-concurrency><option value="1" ${Number(queue.max_concurrent_repositories) === 1 ? "selected" : ""}>1</option><option value="2" ${Number(queue.max_concurrent_repositories) === 2 ? "selected" : ""}>2</option><option value="3" ${Number(queue.max_concurrent_repositories) === 3 ? "selected" : ""}>3</option></select><button class="secondary-button small-button" data-toggle-queue>${queue.paused ? "Retomar fila" : "Pausar fila"}</button>`;
    }
  }

  const runningJobs = sortActiveIndexJobs(state.indexJobs.running || []);
  const historyJobs = state.indexJobs.history || [];
  const running = runningJobs.length;
  if (!running && !historyJobs.length) {
    els.indexSummary.textContent = "Sem jobs";
    els.indexSummary.className = "status-pill muted";
    els.indexRunningList.innerHTML = `<div class="empty-state">Nenhuma indexacao em execucao.</div>`;
    els.indexHistorySummary.textContent = "0 jobs";
    els.indexHistorySummary.className = "status-pill muted";
    els.indexHistoryList.innerHTML = `<div class="empty-state">Nenhuma indexacao finalizada nesse workspace.</div>`;
    els.indexPagination.innerHTML = "";
    return;
  }

  const queued = runningJobs.filter((job) => job.status === "queued").length;
  els.indexSummary.textContent = running ? `${running} ativo(s)${queued ? ` · ${queued} na fila` : ""}` : "Nenhuma em execucao";
  els.indexSummary.className = `status-pill ${running ? "warning" : "muted"}`;
  let queueRank = 0;
  els.indexRunningList.innerHTML = running
    ? runningJobs.map((job) => renderIndexJob(job, { compact: false, queueRank: job.status === "queued" ? ++queueRank : null })).join("")
    : `<div class="empty-state">Nenhuma indexacao em execucao.</div>`;

  els.indexHistorySummary.textContent = `${state.indexJobs.total} jobs`;
  els.indexHistorySummary.className = `status-pill ${state.indexJobs.total ? "online" : "muted"}`;
  els.indexHistoryList.innerHTML = historyJobs.length
    ? historyJobs.map((job) => renderIndexJob(job, { compact: true })).join("")
    : `<div class="empty-state">Nenhuma indexacao finalizada nessa pagina.</div>`;
  renderIndexPagination();
}

function sortActiveIndexJobs(jobs) {
  const statusOrder = { running: 0, canceling: 1, queued: 2, paused: 3 };
  return [...jobs].sort((left, right) => {
    const statusDifference = (statusOrder[left.status] ?? 9) - (statusOrder[right.status] ?? 9);
    if (statusDifference) return statusDifference;
    if (left.status === "queued" && right.status === "queued") {
      const priorityDifference = Number(left.priority ?? 100) - Number(right.priority ?? 100);
      if (priorityDifference) return priorityDifference;
      const leftPosition = left.queue_position == null ? Number.MAX_SAFE_INTEGER : Number(left.queue_position);
      const rightPosition = right.queue_position == null ? Number.MAX_SAFE_INTEGER : Number(right.queue_position);
      if (leftPosition !== rightPosition) return leftPosition - rightPosition;
    }
    return new Date(left.started_at || left.created_at) - new Date(right.started_at || right.created_at);
  });
}

function renderIndexJob(job, options = {}) {
  const fileTotal = Number(job.total_files || 0);
  const fileDone = Number(job.files_indexed || 0);
  const repoTotal = Number(job.total_repository_files || 0);
  const skippedFiles = Number(job.skipped_files || 0);
  const chunkTotal = Number(job.total_chunks || 0);
  const chunkDone = Number(job.chunks_indexed || 0);
  const repoName = job.repository_name || job.current_repository || "workspace";
  const currentFile = job.current_file || "Aguardando próximo estágio";
  const metrics = job.metrics || {};
  const telemetry = liveTelemetry(job);
  const isLive = job.status === "running" || job.status === "canceling";
  const invalidCounters = (fileTotal > 0 && fileDone > fileTotal) || (chunkTotal > 0 && chunkDone > chunkTotal);
  const waiting = ["queued", "paused"].includes(job.status);
  const timeLabel = waiting ? "Tempo em fila" : isLive ? "Tempo em processamento" : "Duração";
  const displayedTime = waiting ? Date.now() - new Date(job.created_at).getTime() : telemetry.elapsedMs;

  return `
    <article class="index-job ${options.compact ? "compact" : ""} ${isLive ? "is-live" : ""}">
      <header>
        <div>
          <strong>${escapeHtml(repoName)}</strong>
          <span>${escapeHtml(job.scope || "workspace")} · ${escapeHtml(phaseLabel(job.phase))}${options.queueRank ? ` · ${options.queueRank === 1 ? "próximo na fila" : `${options.queueRank}º na fila`}` : ""}</span>
        </div>
        <div class="job-actions">
          <span class="status-pill ${jobStatusClass(job.status)}">${escapeHtml(jobStatusLabel(job.status))}</span>
          ${!options.compact && isIndexJobRunning(job) ? `${job.status === "queued" ? `<button class="secondary-button small-button" data-queue-action="pause" data-index-job="${job.id}">Pausar</button><button class="secondary-button small-button" data-queue-action="top" data-index-job="${job.id}">Topo</button><button class="secondary-button small-button" data-queue-action="up" data-index-job="${job.id}">↑</button><button class="secondary-button small-button" data-queue-action="down" data-index-job="${job.id}">↓</button><button class="secondary-button small-button" data-queue-action="priority" data-index-job="${job.id}">Prioridade</button>` : job.status === "paused" ? `<button class="secondary-button small-button" data-queue-action="resume" data-index-job="${job.id}">Retomar</button><button class="secondary-button small-button" data-queue-action="priority" data-index-job="${job.id}">Prioridade</button>` : ""}<button class="danger-button small-button" data-cancel-index-job="${job.id}" ${job.status === "canceling" ? "disabled" : ""}>${job.status === "canceling" ? "Cancelando" : "Cancelar"}</button>` : ""}
        </div>
      </header>
      <div class="live-metrics">
        <div class="live-metric"><span>${isLive ? "Processando agora" : "Último arquivo"}</span><strong title="${escapeHtml(currentFile)}">${escapeHtml(currentFile)}</strong></div>
        <div class="live-metric"><span>Taxa de arquivos</span><strong>${formatRate(telemetry.filesPerMinute, "arq/min")}</strong></div>
        <div class="live-metric"><span>Taxa de chunks</span><strong>${formatRate(telemetry.chunksPerMinute, "chunks/min")}</strong></div>
        <div class="live-metric eta"><span>${timeLabel}</span><strong>${formatDuration(displayedTime)}</strong></div>
      </div>
      <div class="progress-block">
        <div class="progress-label"><span>Progresso geral · ${escapeHtml(phaseLabel(job.phase))}</span><strong>${telemetry.progressPercent.toFixed(1)}%</strong></div>
        ${renderProgressBar(telemetry.progressPercent, 100)}
      </div>
      <details class="pipeline-details" data-pipeline-job="${job.id}" ${state.expandedIndexJobs.has(job.id) ? "open" : ""}>
        <summary><span>Detalhes das etapas</span><span class="details-hint">Expandir</span></summary>
        <div class="pipeline-details-body">
          ${renderPipelineStages(job, telemetry)}
          <div class="job-meta">
            <div><span>Arquivos no repo</span><strong>${repoTotal || "—"}</strong></div>
            <div><span>Ignorados</span><strong>${skippedFiles}</strong></div>
            <div><span>Símbolos</span><strong>${Number(job.symbols_indexed || 0)}</strong></div>
            <div><span>Regras identificadas</span><strong>${Number(job.business_rules_indexed || 0)}</strong></div>
            <div><span>Restantes</span><strong>${telemetry.remainingFiles ?? "—"}</strong></div>
            <div><span>Início</span><strong>${formatDateTime(job.started_at || job.created_at)}</strong></div>
            <div><span>Tempo em fila</span><strong>${formatDuration((job.started_after ? new Date(job.started_after) : new Date()) - new Date(job.created_at))}</strong></div>
          </div>
          ${renderTimingStrip(metrics)}
        </div>
      </details>
      ${invalidCounters ? `<div class="job-error">Contadores inconsistentes detectados. Este job foi iniciado por uma versão anterior; reinicie ou reexecute a indexação para recalcular a telemetria.</div>` : ""}
      ${job.error ? `<div class="job-error">${escapeHtml(job.error)}</div>` : ""}
    </article>
  `;
}

function liveTelemetry(job) {
  const telemetry = job.telemetry || {};
  const startedAt = job.started_at ? new Date(job.started_at).getTime() : null;
  const finishedAt = job.finished_at ? new Date(job.finished_at).getTime() : null;
  const now = Date.now();
  const elapsedMs = startedAt ? Math.max(0, (finishedAt || now) - startedAt) : Number(telemetry.elapsed_ms || 0);
  const minutes = elapsedMs / 60000;
  const filesDone = Number(job.files_indexed || 0);
  const chunksDone = Number(job.chunks_indexed || 0);
  const total = Number(job.total_files || 0);
  const filesPerMinute = minutes > 0 ? filesDone / minutes : Number(telemetry.files_per_minute || 0);
  const chunksPerMinute = minutes > 0 ? chunksDone / minutes : Number(telemetry.chunks_per_minute || 0);
  const remainingFiles = total > 0 ? Math.max(total - filesDone, 0) : null;
  const stages = job.telemetry?.stages || job.metrics?.pipeline || {};
  const weights = { scan: 2, files: 30, embeddings: 30, business_rules: 10, graph_write: 10, relationship_resolution: 9, graph_sync: 7, symbol_linking: 2 };
  let progressPercent = total > 0 ? Math.min(100, (filesDone / total) * 100) : 0;
  if (Object.keys(stages).length) {
    progressPercent = Object.entries(weights).reduce((sum, [key, weight]) => {
      const stage = stages[key] || {};
      const value = stage.status === "completed" ? 100 : Math.min(100, Number(stage.progress_percent || 0));
      return sum + value * weight / 100;
    }, 0);
  }
  return { elapsedMs, filesPerMinute, chunksPerMinute, remainingFiles, progressPercent, stages };
}

function renderPipelineStages(job, telemetry) {
  const definitions = [
    ["scan", "Mapeamento"], ["files", "Análise de arquivos"], ["embeddings", "Embeddings"],
    ["business_rules", "Regras de negócio"],
    ["graph_write", "Gravação no Neo4j"], ["relationship_resolution", "Resolução de relações"],
    ["graph_sync", "Sincronização do grafo"], ["symbol_linking", "Vínculos entre símbolos"]
  ];
  return `<div class="stage-list">${definitions.map(([key, label]) => {
    const stage = telemetry.stages[key] || {};
    const percent = stage.status === "completed" ? 100 : Math.min(100, Number(stage.progress_percent || 0));
    const status = stage.status || "pending";
    const count = Number(stage.total || 0) > 1 ? `${Number(stage.done || 0)}/${Number(stage.total)}` : stageStatusLabel(status);
    return `<div class="stage-row ${status}"><div class="stage-label"><span>${label}</span><strong>${count} · ${percent.toFixed(0)}%</strong></div>${renderProgressBar(percent, 100)}</div>`;
  }).join("")}</div>`;
}

function stageStatusLabel(status) {
  return { pending: "Aguardando", running: "Em andamento", completed: "Concluído", error: "Erro" }[status] || status;
}

function formatRate(value, unit) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const formatted = value >= 100 ? Math.round(value) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${formatted} ${unit}`;
}

function renderTimingStrip(metrics) {
  if (!metrics || !Object.keys(metrics).length) return "";
  const entries = [
    ["Scan", metrics.scan_ms], ["Parsing", metrics.parsing_ms], ["Embeddings", metrics.embedding_ms],
    ["Qdrant", metrics.qdrant_write_ms], ["PostgreSQL", metrics.postgres_write_ms], ["Neo4j", metrics.neo4j_write_ms]
  ].filter(([, value]) => Number(value || 0) > 0);
  if (!entries.length) return "";
  return `<div class="timing-strip">${entries.map(([label, value]) => `<span>${label}<strong>${formatDuration(value)}</strong></span>`).join("")}</div>`;
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000));
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

function renderIndexPagination() {
  const { page, totalPages, total } = state.indexJobs;
  if (!total) {
    els.indexPagination.innerHTML = "";
    return;
  }

  els.indexPagination.innerHTML = `
    <button class="secondary-button" data-index-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>Anterior</button>
    <span>Pagina ${page} de ${totalPages}</span>
    <button class="secondary-button" data-index-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>Proxima</button>
  `;
}

function renderProgressBar(done, total) {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return `
    <div class="progress-track" aria-label="${percent}%">
      <span class="progress-fill" style="width: ${percent}%"></span>
    </div>
  `;
}

function isIndexJobRunning(job) {
  return ["queued", "running", "paused", "canceling"].includes(job.status);
}

function jobStatusClass(status) {
  if (status === "completed") {
    return "online";
  }
  if (status === "error") {
    return "offline";
  }
  if (isIndexJobRunning({ status })) {
    return "warning";
  }
  return "muted";
}

function jobStatusLabel(status) {
  const labels = {
    queued: "Na fila",
    paused: "Pausado",
    running: "Rodando",
    canceling: "Cancelando",
    canceled: "Cancelado",
    completed: "Concluido",
    error: "Erro"
  };
  return labels[status] || status || "-";
}

function phaseLabel(phase) {
  const labels = {
    preparing: "preparando",
    scanning: "escaneando",
    extracting: "extraindo arquivos",
    embedding: "gerando embeddings",
    symbols: "extraindo simbolos",
    business_rules: "identificando regras de negócio",
    graph: "montando grafo",
    graph_write: "gravando grafo",
    resolving_relationships: "resolvendo relações",
    graph_sync: "sincronizando grafo",
    symbol_linking: "relacionando símbolos",
    canceling: "cancelando",
    canceled: "cancelado",
    completed: "concluido",
    error: "erro"
  };
  return labels[phase] || phase || "aguardando";
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderMcp() {
  els.mcpBaseUrl.textContent = state.mcp.base_url || "-";
  els.openWebUiEndpointTemplate.textContent = state.mcp.base_url ? `${state.mcp.base_url}?workspace_slug=<workspace_slug>` : "-";
  els.mcpConfigExample.textContent = `[mcp_servers.company]
url = "${state.mcp.base_url || "http://<IP_DO_SERVIDOR>:7000/mcp"}"
headers = { "Authorization" = "Bearer <GATEWAY_API_KEY>" }`;

  els.toolList.innerHTML = state.mcp.tools.length
    ? state.mcp.tools.map((tool) => `<span>${escapeHtml(tool)}</span>`).join("")
    : `<div class="empty-state">Nenhuma tool disponivel ou Gateway indisponivel.</div>`;

}

function setMcpIntegrationTab(tab) {
  state.mcpIntegrationTab = tab === "open-webui" ? "open-webui" : "ide";
  document.querySelectorAll("[data-mcp-tab]").forEach((button) => {
    const active = button.dataset.mcpTab === state.mcpIntegrationTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelector("#mcpIdePanel")?.classList.toggle("active", state.mcpIntegrationTab === "ide");
  document.querySelector("#mcpOpenWebUiPanel")?.classList.toggle("active", state.mcpIntegrationTab === "open-webui");
}

function renderMcpSkill() {
  const available = new Set(state.workspaces.map((workspace) => workspace.slug));
  state.mcpSkill.selectedSlugs = new Set([...state.mcpSkill.selectedSlugs].filter((slug) => available.has(slug)));
  const selectedCount = state.mcpSkill.selectedSlugs.size;
  const summary = selectedCount
    ? `${selectedCount} workspace${selectedCount === 1 ? "" : "s"} selecionado${selectedCount === 1 ? "" : "s"}.`
    : "Selecione ao menos um workspace.";
  els.mcpSkillSummary.textContent = summary;
  els.openWebUiWorkspaceSummary.textContent = selectedCount === 1
    ? "1 workspace selecionado. O Gateway ficará fixado nele."
    : "Selecione exatamente um workspace.";
  els.generateMcpSkill.disabled = !selectedCount;
  els.generateOpenWebUiPrompt.disabled = selectedCount !== 1;
  const workspaceOptions = state.workspaces.length
    ? state.workspaces.map((workspace) => `<label class="mcp-skill-workspace"><input type="checkbox" data-mcp-skill-workspace="${escapeHtml(workspace.slug)}" ${state.mcpSkill.selectedSlugs.has(workspace.slug) ? "checked" : ""}><span><strong>${escapeHtml(workspace.name)}</strong><code>${escapeHtml(workspace.slug)}</code><small>${Number(workspace.repository_count || 0)} repositório${Number(workspace.repository_count || 0) === 1 ? "" : "s"} mapeado${Number(workspace.repository_count || 0) === 1 ? "" : "s"}</small></span></label>`).join("")
    : `<div class="empty-state">Crie um workspace antes de gerar uma configuração.</div>`;
  els.mcpSkillWorkspaceList.innerHTML = workspaceOptions;
  els.openWebUiWorkspaceList.innerHTML = workspaceOptions;
  els.mcpSkillOutput.classList.toggle("hidden", !state.mcpSkill.content);
  els.copyMcpSkill.disabled = !state.mcpSkill.content;
  if (state.mcpSkill.content) {
    els.mcpSkillFilename.textContent = `${state.mcpSkill.name || "company-mcp"}/SKILL.md`;
    els.mcpSkillContent.textContent = state.mcpSkill.content;
  }
  els.openWebUiPromptOutput.classList.toggle("hidden", !state.openWebUiPrompt.content);
  if (state.openWebUiPrompt.content) {
    els.openWebUiPromptContent.textContent = state.openWebUiPrompt.content;
    els.openWebUiMcpUrl.textContent = state.openWebUiPrompt.mcpUrl || "-";
  }
}

async function loadServices() {
  const data = await api("/api/services");
  state.services = data.services || [];
  renderServices();

  const gateway = state.services.find((service) => service.id === "mcp-gateway");
  if (gateway) {
    setStatus(els.mcpStatus, gateway.online);
  }
}

async function loadContainers() {
  const data = await api("/api/containers");
  state.containers = data.containers || [];
  renderContainers(data.error);
}

async function loadWorkspaces() {
  const data = await api("/api/workspaces");
  state.workspaces = data.workspaces || [];
  if (state.selectedWorkspace) {
    state.selectedWorkspace = state.workspaces.find((workspace) => workspace.slug === state.selectedWorkspace.slug) || null;
    if (!state.selectedWorkspace) {
      showWorkspaceListScreen();
    }
  }
  renderWorkspaces();
  renderMcpSkill();
  if (els.graphWorkspace) {
    const selected = els.graphWorkspace.value;
    els.graphWorkspace.innerHTML = `<option value="">Selecione um workspace</option>${state.workspaces.map((workspace) => `<option value="${escapeHtml(workspace.slug)}">${escapeHtml(workspace.name)}</option>`).join("")}`;
    if (state.workspaces.some((workspace) => workspace.slug === selected)) els.graphWorkspace.value = selected;
  }
}

async function loadMcp() {
  state.mcp = await api("/api/mcp");
  renderMcp();
}

async function loadIndexJobs(slug = state.selectedWorkspace?.slug) {
  if (!slug) {
    resetIndexJobState();
    renderIndexJobs();
    return;
  }

  try {
    const [runningData, historyData] = await Promise.all([
      api(`/api/workspaces/${encodeURIComponent(slug)}/index-jobs?state=running&limit=20`),
      api(`/api/workspaces/${encodeURIComponent(slug)}/index-jobs?state=finished&page=${state.indexJobs.page}&limit=${state.indexJobs.limit}`)
    ]);
    state.indexJobs.running = runningData.jobs || [];
    state.indexJobs.history = historyData.jobs || [];
    state.indexJobs.page = historyData.pagination?.page || 1;
    state.indexJobs.limit = historyData.pagination?.limit || state.indexJobs.limit;
    state.indexJobs.total = historyData.pagination?.total || 0;
    state.indexJobs.totalPages = historyData.pagination?.total_pages || 1;
    state.indexJobs.queue = runningData.queue || state.indexJobs.queue;
    renderIndexJobs();
  } catch (error) {
    renderIndexJobs(error.message);
    throw error;
  }
}

async function selectWorkspace(slug) {
  const workspace = state.workspaces.find((item) => item.slug === slug);
  if (!workspace) {
    return;
  }

  if (state.selectedWorkspace?.slug !== slug) {
    state.indexJobs.page = 1;
    resetIndexReport();
  }
  state.selectedWorkspace = workspace;
  showWorkspaceDetailScreen();
  renderWorkspaces();
  const [repos] = await Promise.all([
    api(`/api/workspaces/${encodeURIComponent(slug)}/repositories`),
    loadIndexJobs(slug)
  ]);
  renderRepositories(repos);
}

async function loadGraph(slug = els.graphWorkspace?.value || state.selectedWorkspace?.slug) {
  if (!slug || !els.graphCanvas) return;
  els.graphCanvas.innerHTML = `<div class="empty-state">Carregando grafo…</div>`;
  els.reloadGraph.disabled = true;
  try {
    const limit = Number(els.graphLimit?.value || 60);
    state.graph = await api(`/api/workspaces/${encodeURIComponent(slug)}/graph?limit=${limit}`);
    renderGraph();
  } catch (error) {
    els.graphCanvas.innerHTML = `<div class="empty-state">Grafo indisponível: ${escapeHtml(error.message)}</div>`;
  } finally {
    els.reloadGraph.disabled = false;
  }
}

function renderGraph() {
  if (!els.graphCanvas || !state.graph) return;
  const filter = els.graphTypeFilter?.value || "all";
  const search = (els.graphSearch?.value || "").trim().toLocaleLowerCase("pt-BR");
  const nodes = (state.graph.nodes || []).filter((node) => (filter === "all" || node.type === filter) && (!search || `${node.label} ${node.kind || ""}`.toLocaleLowerCase("pt-BR").includes(search)));
  const visible = new Set(nodes.map((node) => node.id));
  const edges = (state.graph.edges || []).filter((edge) => visible.has(edge.source) && visible.has(edge.target));
  if (!nodes.length) {
    els.graphCanvas.innerHTML = `<div class="empty-state">Nenhum nó encontrado para este filtro.</div>`;
    return;
  }
  if (els.graphStats) els.graphStats.textContent = `${nodes.length} nós · ${edges.length} relações${state.graph.truncated ? " · recorte limitado" : ""}`;
  const width = 1400, height = 780;
  const byType = new Map();
  nodes.forEach((node) => { const list = byType.get(node.type) || []; list.push(node); byType.set(node.type, list); });
  const columns = [...byType.entries()];
  const positions = new Map();
  columns.forEach(([type, list], column) => list.forEach((node, row) => positions.set(node.id, {
    x: 100 + column * ((width - 200) / Math.max(1, columns.length - 1)),
    y: 55 + row * ((height - 110) / Math.max(1, list.length - 1)), type
  })));
  const colors = { repository: "#c7f36b", file: "#70b7ff", symbol: "#c99cff", reference: "#ffad66" };
  const degrees = new Map();
  edges.forEach((edge) => { degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1); degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1); });
  els.graphCanvas.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafo técnico do workspace"><g class="graph-viewport">
    <g class="graph-edges">${edges.map((edge) => { const a = positions.get(edge.source), b = positions.get(edge.target); return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"><title>${escapeHtml(edge.type)}</title></line>`; }).join("")}</g>
    <g class="graph-nodes">${nodes.map((node) => { const p = positions.get(node.id); const degree = degrees.get(node.id) || 0; return `<g class="graph-node" data-graph-node="${escapeHtml(node.id)}" transform="translate(${p.x} ${p.y})"><circle r="${node.type === "repository" ? 12 : Math.min(10, 5 + Math.sqrt(degree))}" fill="${colors[node.type] || "#aaa"}"></circle>${nodes.length <= 140 || node.type === "repository" ? `<text x="14" y="4">${escapeHtml(String(node.label).slice(0, 36))}</text>` : ""}<title>${escapeHtml(node.label)} · ${escapeHtml(node.type)} · ${degree} relações</title></g>`; }).join("")}</g>
  </g></svg>`;
  enableGraphNavigation();
}

function enableGraphNavigation() {
  const svg = els.graphCanvas.querySelector("svg"), viewport = svg?.querySelector(".graph-viewport");
  if (!svg || !viewport) return;
  let x = 0, y = 0, scale = 1, dragging = false, startX = 0, startY = 0;
  const apply = () => viewport.setAttribute("transform", `translate(${x} ${y}) scale(${scale})`);
  svg.addEventListener("wheel", (event) => { event.preventDefault(); scale = Math.min(2.5, Math.max(.45, scale * (event.deltaY < 0 ? 1.1 : .9))); apply(); }, { passive: false });
  svg.addEventListener("pointerdown", (event) => { dragging = true; startX = event.clientX - x; startY = event.clientY - y; svg.setPointerCapture(event.pointerId); });
  svg.addEventListener("pointermove", (event) => { if (!dragging) return; x = event.clientX - startX; y = event.clientY - startY; apply(); });
  svg.addEventListener("pointerup", () => { dragging = false; });
}

function inspectGraphNode(id) {
  const node = state.graph?.nodes?.find((item) => item.id === id);
  if (!node) return;
  const related = (state.graph.edges || []).filter((edge) => edge.source === id || edge.target === id);
  els.graphInspector.innerHTML = `<span class="section-kicker">${escapeHtml(node.type)}</span><h3>${escapeHtml(node.label)}</h3>${node.kind ? `<code>${escapeHtml(node.kind)}</code>` : ""}<p>${related.length} relações visíveis</p><ul>${related.slice(0, 30).map((edge) => `<li><strong>${escapeHtml(edge.type)}</strong><span>${escapeHtml(edge.source === id ? edge.target : edge.source)}</span></li>`).join("")}</ul>`;
}

async function loadOperationalLogs() {
  if (!els.operationalLogs) return;
  try {
    const data = await api(`/api/logs?after=${state.logs.latestId}&limit=300`);
    if (data.entries?.length) {
      state.logs.entries.push(...data.entries);
      if (state.logs.entries.length > 600) state.logs.entries.splice(0, state.logs.entries.length - 600);
    }
    state.logs.latestId = Number(data.latest_id || state.logs.latestId);
    state.logs.retained = Number(data.retained || 0);
    els.logsConnectionStatus.textContent = "Ao vivo";
    renderOperationalLogs();
  } catch (error) {
    els.logsConnectionStatus.textContent = "Sem conexão";
    console.warn("operational logs refresh failed", error);
  }
}

function renderOperationalLogs() {
  const level = els.logsLevel?.value || "all";
  const component = els.logsComponent?.value || "all";
  const search = (els.logsSearch?.value || "").trim().toLocaleLowerCase("pt-BR");
  const entries = state.logs.entries.filter((entry) => {
    if (level !== "all" && entry.level !== level) return false;
    if (component !== "all" && entry.component !== component) return false;
    return !search || `${entry.message} ${entry.component} ${JSON.stringify(entry.context || {})}`.toLocaleLowerCase("pt-BR").includes(search);
  });
  els.logsSummary.textContent = `${entries.length} eventos visíveis · ${state.logs.retained} mantidos no servidor`;
  if (!entries.length) {
    els.operationalLogs.innerHTML = `<div class="empty-state">Nenhum evento corresponde aos filtros.</div>`;
    return;
  }
  const wasNearBottom = els.operationalLogs.scrollHeight - els.operationalLogs.scrollTop - els.operationalLogs.clientHeight < 90;
  els.operationalLogs.innerHTML = entries.slice().reverse().map((entry) => {
    const context = Object.entries(entry.context || {}).filter(([, value]) => value !== null && value !== undefined && value !== "");
    return `<article class="log-entry ${escapeHtml(entry.level)}">
      <div class="log-entry-marker"></div>
      <div class="log-entry-body"><div class="log-entry-heading"><span class="log-level">${escapeHtml(entry.level)}</span><strong>${escapeHtml(entry.message)}</strong></div>
      ${context.length ? `<dl>${context.slice(0, 10).map(([key, value]) => `<div><dt>${escapeHtml(key.replaceAll("_", " "))}</dt><dd>${escapeHtml(typeof value === "object" ? JSON.stringify(value) : value)}</dd></div>`).join("")}</dl>` : ""}</div>
      <div class="log-entry-meta"><span>${escapeHtml(entry.component)}</span><time datetime="${escapeHtml(entry.timestamp)}">${new Date(entry.timestamp).toLocaleTimeString("pt-BR")}</time></div>
    </article>`;
  }).join("");
  if (wasNearBottom) els.operationalLogs.scrollTop = 0;
}

async function refreshAll() {
  try {
    await Promise.all([loadServices(), loadContainers(), loadWorkspaces(), loadMcp()]);
    if (state.selectedWorkspace) {
      await selectWorkspace(state.selectedWorkspace.slug);
    }
  } catch (error) {
    toast(error.message);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setRepoSourceMode(mode) {
  state.repoSourceMode = mode === "manual" ? "manual" : "github";
  document.querySelectorAll("[data-repo-source]").forEach((tab) => {
    const active = tab.dataset.repoSource === state.repoSourceMode;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  els.githubRepoSource.classList.toggle("hidden", state.repoSourceMode !== "github");
  els.manualRepoSource.classList.toggle("hidden", state.repoSourceMode !== "manual");
  els.repoName.value = "";
  els.repoUrl.value = "";
  els.remoteRepoSelect.value = "";
}

function openRepoModal() {
  els.repoForm.reset();
  els.repoBranch.value = "main";
  setRepoSourceMode("github");
  els.repoModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  window.setTimeout(() => els.loadGithubRepos.focus(), 0);
}

function renderRemoteRepositoryOptions(query = "") {
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const matches = state.remoteRepos
    .map((repo, index) => ({ repo, index }))
    .filter(({ repo }) => !normalized || `${repo.name} ${repo.full_name}`.toLocaleLowerCase("pt-BR").includes(normalized));

  els.remoteRepoSelect.innerHTML = [
    `<option value="">${matches.length ? `Selecione um repositório (${matches.length})` : "Nenhum repositório encontrado"}</option>`,
    ...matches.map(({ repo, index }) => `<option value="${index}">${escapeHtml(repo.full_name)} (${escapeHtml(repo.default_branch)})</option>`)
  ].join("");
  els.remoteRepoSelect.disabled = matches.length === 0;
}

function closeRepoModal() {
  els.repoModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

document.addEventListener("click", async (event) => {
  const graphNode = event.target.closest("[data-graph-node]");
  if (graphNode) inspectGraphNode(graphNode.dataset.graphNode);
  const repoSourceTab = event.target.closest("[data-repo-source]");
  if (repoSourceTab) {
    setRepoSourceMode(repoSourceTab.dataset.repoSource);
    return;
  }

  const routeLink = event.target.closest("[data-route]");
  if (routeLink) {
    event.preventDefault();
    routeTo(routeLink.dataset.route);
    return;
  }

  const serviceButton = event.target.closest("[data-open-service]");
  if (serviceButton) {
    const service = state.services.find((item) => item.id === serviceButton.dataset.openService);
    if (!service) {
      return;
    }
    if (service.id === "admin") {
      routeTo("admin");
    } else if (service.id === "mcp-gateway") {
      routeTo("mcp");
    } else if (service.can_open && service.url) {
      window.open(service.url, "_blank", "noopener,noreferrer");
    }
    return;
  }

  const workspaceItem = event.target.closest("[data-workspace]");
  if (workspaceItem) {
    await selectWorkspace(workspaceItem.dataset.workspace);
    return;
  }

  const indexPageButton = event.target.closest("[data-index-page]");
  if (indexPageButton && state.selectedWorkspace) {
    const page = Number(indexPageButton.dataset.indexPage);
    if (Number.isFinite(page) && page >= 1 && page <= state.indexJobs.totalPages) {
      state.indexJobs.page = page;
      await loadIndexJobs(state.selectedWorkspace.slug);
    }
    return;
  }

  const explorerButton = event.target.closest("[data-open-repository-explorer]");
  if (explorerButton && state.selectedWorkspace) {
    try {
      explorerButton.disabled = true;
      explorerButton.textContent = "Carregando";
      const data = await api(`/api/workspaces/${encodeURIComponent(state.selectedWorkspace.slug)}/repositories/${encodeURIComponent(explorerButton.dataset.openRepositoryExplorer)}/explorer`);
      state.indexReport = data;
      state.repositoryExplorer = { data, tab: "overview" };
      renderRepositoryExplorer();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      toast(error.message);
    } finally {
      explorerButton.disabled = false;
      explorerButton.textContent = "Explorar";
    }
    return;
  }

  const explorerTab = event.target.closest("[data-explorer-tab]");
  if (explorerTab && state.repositoryExplorer.data) {
    state.repositoryExplorer.tab = explorerTab.dataset.explorerTab;
    if (state.repositoryExplorer.tab === "overview") {
      renderRepositoryExplorer();
    } else {
      const dataset = state.repositoryExplorer.tab === "data" ? "files" : state.repositoryExplorer.tab === "collections" ? "chunks" : "rules";
      try {
        await loadExplorerDataset(dataset);
      } catch (error) {
        toast(error.message);
      }
    }
    return;
  }

  const datasetButton = event.target.closest("[data-explorer-dataset]");
  if (datasetButton && state.repositoryExplorer.data) {
    try {
      await loadExplorerDataset(datasetButton.dataset.explorerDataset);
    } catch (error) {
      toast(error.message);
    }
    return;
  }

  const explorerSearchButton = event.target.closest("[data-explorer-search]");
  if (explorerSearchButton && state.repositoryExplorer.data) {
    const dataset = state.repositoryExplorer.data.explorer?.dataset?.dataset;
    const search = document.querySelector("#explorerDatasetSearch")?.value || "";
    if (dataset) {
      try {
        await loadExplorerDataset(dataset, 1, search);
      } catch (error) {
        toast(error.message);
      }
    }
    return;
  }

  const explorerPageButton = event.target.closest("[data-explorer-page]");
  if (explorerPageButton && state.repositoryExplorer.data) {
    const dataset = state.repositoryExplorer.data.explorer?.dataset;
    const page = Number(explorerPageButton.dataset.explorerPage);
    if (dataset && Number.isFinite(page) && page >= 1 && page <= dataset.total_pages) {
      try {
        await loadExplorerDataset(dataset.dataset, page, dataset.search || "");
      } catch (error) {
        toast(error.message);
      }
    }
    return;
  }

  const cancelIndexJobButton = event.target.closest("[data-cancel-index-job]");
  if (cancelIndexJobButton && state.selectedWorkspace) {
    try {
      cancelIndexJobButton.disabled = true;
      cancelIndexJobButton.textContent = "Cancelando";
      await api(`/api/workspaces/${encodeURIComponent(state.selectedWorkspace.slug)}/index-jobs/${encodeURIComponent(cancelIndexJobButton.dataset.cancelIndexJob)}/cancel`, {
        method: "POST"
      });
      toast("Cancelamento solicitado.");
      await loadIndexJobs(state.selectedWorkspace.slug);
      const repos = await api(`/api/workspaces/${encodeURIComponent(state.selectedWorkspace.slug)}/repositories`);
      renderRepositories(repos);
    } catch (error) {
      toast(error.message);
    }
    return;
  }

  const queueActionButton = event.target.closest("[data-queue-action]");
  if (queueActionButton && state.selectedWorkspace) {
    try {
      let payload = {};
      if (queueActionButton.dataset.queueAction === "priority") {
        const value = prompt("Prioridade (0 = mais alta, 1000 = mais baixa):", "100");
        if (value === null) return;
        payload = { priority: Number(value) };
      }
      await api(`/api/workspaces/${encodeURIComponent(state.selectedWorkspace.slug)}/index-jobs/${encodeURIComponent(queueActionButton.dataset.indexJob)}/queue/${encodeURIComponent(queueActionButton.dataset.queueAction)}`, { method: "POST", body: JSON.stringify(payload) });
      await loadIndexJobs(state.selectedWorkspace.slug);
    } catch (error) {
      toast(error.message);
    }
    return;
  }

  if (event.target.closest("[data-toggle-queue]")) {
    try {
      await api("/api/index-queue", { method: "PUT", body: JSON.stringify({ paused: !state.indexJobs.queue?.paused }) });
      await loadIndexJobs();
    } catch (error) {
      toast(error.message);
    }
    return;
  }

  const deleteRepoButton = event.target.closest("[data-delete-repo]");
  const reindexRepoButton = event.target.closest("[data-reindex-repo]");
  if (reindexRepoButton && state.selectedWorkspace) {
    try {
      reindexRepoButton.disabled = true;
      reindexRepoButton.textContent = "Indexando...";
      await api(`/api/workspaces/${encodeURIComponent(state.selectedWorkspace.slug)}/repositories/${encodeURIComponent(reindexRepoButton.dataset.reindexRepo)}`, {
        method: "POST"
      });
      toast("Reindexacao iniciada.");
      await loadWorkspaces();
      await selectWorkspace(state.selectedWorkspace.slug);
    } catch (error) {
      toast(error.message);
    } finally {
      reindexRepoButton.disabled = false;
      reindexRepoButton.textContent = "Reindexar";
    }
    return;
  }

  if (deleteRepoButton && state.selectedWorkspace) {
    if (!confirm("Remover o repositorio do banco e apagar a pasta clonada?")) {
      return;
    }
    try {
      await api(`/api/workspaces/${encodeURIComponent(state.selectedWorkspace.slug)}/repositories/${encodeURIComponent(deleteRepoButton.dataset.deleteRepo)}`, {
        method: "DELETE"
      });
      toast("Repositorio removido.");
      await loadWorkspaces();
      await selectWorkspace(state.selectedWorkspace.slug);
    } catch (error) {
      toast(error.message);
    }
  }
});

els.reloadGraph?.addEventListener("click", () => loadGraph());
els.graphTypeFilter?.addEventListener("change", renderGraph);
els.graphSearch?.addEventListener("input", renderGraph);
els.logsLevel?.addEventListener("change", renderOperationalLogs);
els.logsComponent?.addEventListener("change", renderOperationalLogs);
els.logsSearch?.addEventListener("input", renderOperationalLogs);
els.clearVisibleLogs?.addEventListener("click", () => {
  state.logs.entries = [];
  renderOperationalLogs();
});
els.graphWorkspace?.addEventListener("change", () => {
  state.graph = null;
  els.graphCanvas.innerHTML = `<div class="empty-state">Clique em “Carregar recorte” para consultar este workspace.</div>`;
  els.graphStats.textContent = els.graphWorkspace.value ? "Pronto para carregar." : "Selecione um workspace para começar.";
});
els.openWorkspaceGraph?.addEventListener("click", () => {
  if (state.selectedWorkspace && els.graphWorkspace) els.graphWorkspace.value = state.selectedWorkspace.slug;
  routeTo("graph");
});

els.refreshButton.addEventListener("click", refreshAll);
els.backToRepositories?.addEventListener("click", showRepositoryList);

const handleMcpWorkspaceSelection = (event) => {
  const checkbox = event.target.closest("[data-mcp-skill-workspace]");
  if (!checkbox) return;
  const slug = checkbox.dataset.mcpSkillWorkspace;
  if (event.currentTarget === els.openWebUiWorkspaceList && checkbox.checked) state.mcpSkill.selectedSlugs = new Set([slug]);
  else if (checkbox.checked) state.mcpSkill.selectedSlugs.add(slug);
  else state.mcpSkill.selectedSlugs.delete(slug);
  state.mcpSkill.content = "";
  state.mcpSkill.name = "";
  state.openWebUiPrompt.content = "";
  state.openWebUiPrompt.mcpUrl = "";
  renderMcpSkill();
};
els.mcpSkillWorkspaceList?.addEventListener("change", handleMcpWorkspaceSelection);
els.openWebUiWorkspaceList?.addEventListener("change", handleMcpWorkspaceSelection);

document.querySelectorAll("[data-mcp-tab]").forEach((button) => {
  button.addEventListener("click", () => setMcpIntegrationTab(button.dataset.mcpTab));
});

els.generateMcpSkill?.addEventListener("click", async () => {
  try {
    els.generateMcpSkill.disabled = true;
    els.generateMcpSkill.textContent = "Gerando…";
    const data = await api("/api/mcp/skill", {
      method: "POST",
      body: JSON.stringify({ workspace_slugs: [...state.mcpSkill.selectedSlugs] })
    });
    state.mcpSkill.content = data.skill?.content || "";
    state.mcpSkill.name = data.skill?.name || "company-mcp";
    renderMcpSkill();
    toast("Skill gerada. Copie o conteúdo para SKILL.md do seu agente.");
  } catch (error) {
    toast(error.message);
  } finally {
    els.generateMcpSkill.textContent = "Gerar skill";
    els.generateMcpSkill.disabled = state.mcpSkill.selectedSlugs.size === 0;
  }
});

els.copyMcpSkill?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.mcpSkill.content);
    toast("SKILL.md copiado para a área de transferência.");
  } catch {
    toast("Não foi possível copiar automaticamente. Selecione o conteúdo abaixo.");
  }
});

els.generateOpenWebUiPrompt?.addEventListener("click", async () => {
  try {
    els.generateOpenWebUiPrompt.disabled = true;
    els.generateOpenWebUiPrompt.textContent = "Gerando…";
    const data = await api("/api/mcp/open-webui-prompt", {
      method: "POST",
      body: JSON.stringify({ workspace_slugs: [...state.mcpSkill.selectedSlugs] })
    });
    state.openWebUiPrompt.content = data.prompt?.content || "";
    state.openWebUiPrompt.mcpUrl = data.prompt?.mcp_url || "";
    renderMcpSkill();
    toast("Prompt do Open WebUI gerado.");
  } catch (error) {
    toast(error.message);
  } finally {
    els.generateOpenWebUiPrompt.textContent = "Gerar prompt Open WebUI";
    els.generateOpenWebUiPrompt.disabled = state.mcpSkill.selectedSlugs.size !== 1;
  }
});

els.copyOpenWebUiPrompt?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.openWebUiPrompt.content);
    toast("Prompt do Open WebUI copiado.");
  } catch {
    toast("Não foi possível copiar automaticamente. Selecione o conteúdo abaixo.");
  }
});

els.saveAdminKey.addEventListener("click", () => {
  localStorage.setItem("adminApiKey", els.adminKey.value.trim());
  toast("Chave salva no navegador.");
  refreshAll();
});

els.newWorkspaceButton.addEventListener("click", () => {
  els.workspaceForm.classList.toggle("hidden");
});

els.backToWorkspaces.addEventListener("click", () => {
  showWorkspaceListScreen();
});

els.openRepoModal.addEventListener("click", openRepoModal);
els.closeRepoModal.addEventListener("click", closeRepoModal);
els.cancelRepoModal.addEventListener("click", closeRepoModal);
els.repoModal.addEventListener("click", (event) => {
  if (event.target === els.repoModal) closeRepoModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.repoModal.classList.contains("hidden")) closeRepoModal();
});
document.addEventListener("toggle", (event) => {
  const details = event.target.closest?.("[data-pipeline-job]");
  if (!details) return;
  if (details.open) state.expandedIndexJobs.add(details.dataset.pipelineJob);
  else state.expandedIndexJobs.delete(details.dataset.pipelineJob);
}, true);

els.workspaceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await api("/api/workspaces", {
      method: "POST",
      body: JSON.stringify({
        name: els.workspaceName.value,
        slug: els.workspaceSlug.value,
        description: els.workspaceDescription.value
      })
    });
    els.workspaceForm.reset();
    els.workspaceForm.classList.add("hidden");
    toast("Workspace criado.");
    await loadWorkspaces();
    await selectWorkspace(data.workspace.slug);
  } catch (error) {
    toast(error.message);
  }
});

els.loadGithubRepos.addEventListener("click", async () => {
  try {
    els.loadGithubRepos.disabled = true;
    els.loadGithubRepos.textContent = "Buscando...";
    const data = await api("/api/git/repositories");
    state.remoteRepos = data.repositories || [];
    els.githubRepoSearch.disabled = false;
    els.githubRepoSearch.value = "";
    renderRemoteRepositoryOptions();
    els.githubRepoSearch.focus();
    toast(`${state.remoteRepos.length} repositorios carregados.`);
  } catch (error) {
    toast(error.message);
  } finally {
    els.loadGithubRepos.disabled = false;
    els.loadGithubRepos.textContent = "Carregar repositórios";
  }
});

els.githubRepoSearch.addEventListener("input", () => {
  els.repoName.value = "";
  els.repoUrl.value = "";
  renderRemoteRepositoryOptions(els.githubRepoSearch.value);
});

els.remoteRepoSelect.addEventListener("change", () => {
  if (els.remoteRepoSelect.value === "") {
    els.repoName.value = "";
    els.repoUrl.value = "";
    return;
  }
  const repo = state.remoteRepos[Number(els.remoteRepoSelect.value)];
  if (!repo) {
    return;
  }
  els.repoName.value = repo.name;
  els.repoUrl.value = repo.url;
  els.repoBranch.value = repo.default_branch || "main";
});

document.addEventListener("change", async (event) => {
  if (!event.target.matches("[data-queue-concurrency]")) return;
  try {
    await api("/api/index-queue", { method: "PUT", body: JSON.stringify({ max_concurrent_repositories: Number(event.target.value) }) });
    await loadIndexJobs();
  } catch (error) {
    toast(error.message);
  }
});

els.repoForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.selectedWorkspace) {
    toast("Selecione um workspace.");
    return;
  }

  if (state.repoSourceMode === "github" && !els.remoteRepoSelect.value) {
    toast("Busque e selecione um repositório do GitHub.");
    return;
  }
  if (state.repoSourceMode === "manual" && (!els.repoName.value.trim() || !els.repoUrl.value.trim())) {
    toast("Informe o nome e a URL de clone do repositório.");
    return;
  }

  try {
    const button = els.repoForm.querySelector("[data-repo-submit]");
    button.disabled = true;
    button.textContent = "Clonando...";
    await api(`/api/workspaces/${encodeURIComponent(state.selectedWorkspace.slug)}/repositories`, {
      method: "POST",
      body: JSON.stringify({
        provider: "github",
        name: els.repoName.value,
        url: els.repoUrl.value,
        default_branch: els.repoBranch.value || "main"
      })
    });
    els.repoForm.reset();
    els.repoBranch.value = "main";
    setRepoSourceMode(state.repoSourceMode);
    closeRepoModal();
    toast("Repositorio clonado. Indexacao iniciada em background.");
    await loadWorkspaces();
    await selectWorkspace(state.selectedWorkspace.slug);
  } catch (error) {
    toast(error.message);
  } finally {
    const button = els.repoForm.querySelector("[data-repo-submit]");
    button.disabled = false;
    button.textContent = "Adicionar e indexar";
  }
});

window.addEventListener("popstate", () => {
  routeTo(routeFromPath());
});

window.setInterval(async () => {
  if (!state.selectedWorkspace || routeFromPath() !== "admin") {
    return;
  }

  try {
    const hadRunningJobs = state.indexJobs.running.some(isIndexJobRunning);
    await loadIndexJobs(state.selectedWorkspace.slug);
    if (hadRunningJobs || state.indexJobs.running.some(isIndexJobRunning)) {
      const repos = await api(`/api/workspaces/${encodeURIComponent(state.selectedWorkspace.slug)}/repositories`);
      renderRepositories(repos);
    }
  } catch (error) {
    console.warn("index progress refresh failed", error);
  }
}, 2000);

// Mantem cronometro e taxas fluidos entre as consultas ao backend.
window.setInterval(() => {
  if (!state.selectedWorkspace || routeFromPath() !== "admin" || !state.indexJobs.running.some(isIndexJobRunning)) return;
  renderIndexJobs();
}, 1000);

window.setInterval(() => {
  if (routeFromPath() === "logs") void loadOperationalLogs();
}, 2000);

els.adminKey.value = localStorage.getItem("adminApiKey") || "";
routeTo(routeFromPath());
refreshAll();
loadOperationalLogs();
