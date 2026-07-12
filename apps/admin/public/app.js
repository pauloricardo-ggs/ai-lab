const state = {
  services: [],
  containers: [],
  workspaces: [],
  selectedWorkspace: null,
  mcp: { tools: [], base_url: "" },
  remoteRepos: [],
  repoSourceMode: "github",
  expandedIndexJobs: new Set(),
  indexReport: null,
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
  qualityReportSection: document.querySelector("#qualityReportSection"),
  qualityReportTitle: document.querySelector("#qualityReportTitle"),
  qualityReportSummary: document.querySelector("#qualityReportSummary"),
  qualityReportBody: document.querySelector("#qualityReportBody"),
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
  mcpStatus: document.querySelector("#mcpStatus"),
  mcpBaseUrl: document.querySelector("#mcpBaseUrl"),
  mcpConfigExample: document.querySelector("#mcpConfigExample"),
  toolList: document.querySelector("#toolList"),
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
    mcp: "MCP Gateway"
  };
  els.pageTitle.textContent = titles[route] || "Dashboard";

  const path = route === "dashboard" ? "/" : route === "mcp" ? "/services/mcp-gateway" : "/admin";
  if (window.location.pathname !== path) {
    history.pushState({ route }, "", path);
  }
}

function routeFromPath() {
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
  if (els.qualityReportSection) {
    els.qualityReportSection.classList.add("hidden");
    els.qualityReportBody.innerHTML = "";
    els.qualityReportSummary.textContent = "-";
    els.qualityReportSummary.className = "status-pill muted";
  }
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
                <strong>${escapeHtml(repo.name)}</strong><br>
                <span class="muted-text">${escapeHtml(repo.url)}</span>
              </td>
              <td><span class="status-pill ${["active", "indexed"].includes(repo.status) ? "online" : ["error", "index_error", "index_canceled"].includes(repo.status) ? "offline" : "warning"}">${escapeHtml(repo.status)}</span></td>
              <td>${escapeHtml(repo.default_branch || "-")}</td>
              <td><code>${escapeHtml(repo.local_path || "-")}</code></td>
              <td>
                <button class="secondary-button" data-index-report-repo="${repo.id}">Relatorio</button>
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
  if (!report || !els.qualityReportSection) {
    resetIndexReport();
    return;
  }

  const summary = report.summary || {};
  const indexed = Number(summary.indexed || 0);
  const skipped = Number(summary.skipped || 0);
  const errors = Number(summary.errors || 0);
  const total = Number(summary.total || 0);
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

  els.qualityReportSection.classList.remove("hidden");
  els.qualityReportTitle.textContent = `Qualidade · ${report.repository.name}`;
  els.qualityReportSummary.textContent = `${score}% indexado`;
  els.qualityReportSummary.className = `status-pill ${errors ? "offline" : skipped ? "warning" : indexed ? "online" : "muted"}`;
  els.qualityReportBody.innerHTML = `
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
      ${metricCard("Resolvidas", resolved)}
      ${metricCard("Não resolvidas", unresolved)}
    </div>
    ${renderLatestReportRun(report.latest_job)}
    <div class="quality-columns">
      ${languageCoverageTable("Arquivos por linguagem", report.files_by_language)}
      ${reportTable("Simbolos por linguagem", report.symbols_by_language, "language")}
      ${reportTable("Simbolos por tipo", report.symbols_by_type, "type")}
      ${reportTable("Relacoes por tipo", report.relationships_by_type, "type")}
      ${reportTable("Resolucao de relacoes", report.relationships_by_resolution, "status")}
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
  const weights = { scan: 2, files: 35, embeddings: 35, graph_write: 10, relationship_resolution: 9, graph_sync: 7, symbol_linking: 2 };
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
  els.mcpConfigExample.textContent = `[mcp_servers.company]
url = "${state.mcp.base_url || "http://<IP_DO_SERVIDOR>:7000/mcp"}"
headers = { "Authorization" = "Bearer <GATEWAY_API_KEY>" }`;

  els.toolList.innerHTML = state.mcp.tools.length
    ? state.mcp.tools.map((tool) => `<span>${escapeHtml(tool)}</span>`).join("")
    : `<div class="empty-state">Nenhuma tool disponivel ou Gateway indisponivel.</div>`;

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

  const indexReportButton = event.target.closest("[data-index-report-repo]");
  if (indexReportButton && state.selectedWorkspace) {
    try {
      indexReportButton.disabled = true;
      indexReportButton.textContent = "Carregando";
      const report = await api(`/api/workspaces/${encodeURIComponent(state.selectedWorkspace.slug)}/repositories/${encodeURIComponent(indexReportButton.dataset.indexReportRepo)}/index-report`);
      state.indexReport = report;
      renderIndexReport(report);
      els.qualityReportSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      toast(error.message);
    } finally {
      indexReportButton.disabled = false;
      indexReportButton.textContent = "Relatorio";
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

els.refreshButton.addEventListener("click", refreshAll);

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

els.adminKey.value = localStorage.getItem("adminApiKey") || "";
routeTo(routeFromPath());
refreshAll();
