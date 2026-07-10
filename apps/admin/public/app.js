const state = {
  services: [],
  containers: [],
  workspaces: [],
  selectedWorkspace: null,
  mcp: { tools: [], base_url: "" },
  remoteRepos: []
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
  selectedWorkspaceTitle: document.querySelector("#selectedWorkspaceTitle"),
  selectedWorkspaceSlug: document.querySelector("#selectedWorkspaceSlug"),
  repoEmptyState: document.querySelector("#repoEmptyState"),
  repoManager: document.querySelector("#repoManager"),
  repoList: document.querySelector("#repoList"),
  repoForm: document.querySelector("#repoForm"),
  repoName: document.querySelector("#repoName"),
  repoUrl: document.querySelector("#repoUrl"),
  repoBranch: document.querySelector("#repoBranch"),
  githubOwner: document.querySelector("#githubOwner"),
  loadGithubRepos: document.querySelector("#loadGithubRepos"),
  remoteRepoSelect: document.querySelector("#remoteRepoSelect"),
  mcpStatus: document.querySelector("#mcpStatus"),
  mcpBaseUrl: document.querySelector("#mcpBaseUrl"),
  mcpConfigExample: document.querySelector("#mcpConfigExample"),
  toolList: document.querySelector("#toolList"),
  toolSelect: document.querySelector("#toolSelect"),
  toolWorkspaceSelect: document.querySelector("#toolWorkspaceSelect"),
  toolPayload: document.querySelector("#toolPayload"),
  toolTestForm: document.querySelector("#toolTestForm"),
  toolResponse: document.querySelector("#toolResponse"),
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
    dashboard: "Dashboard",
    admin: "Admin Panel",
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
        <button class="secondary-button" data-open-service="${service.id}">${service.kind === "api" ? "Console" : "Abrir"}</button>
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

  els.toolWorkspaceSelect.innerHTML = [
    `<option value="">Selecionar workspace</option>`,
    ...state.workspaces.map((workspace) => `<option value="${workspace.slug}">${escapeHtml(workspace.name)} (${escapeHtml(workspace.slug)})</option>`)
  ].join("");
}

function renderRepositories(payload) {
  if (!payload || !state.selectedWorkspace) {
    els.repoEmptyState.classList.remove("hidden");
    els.repoManager.classList.add("hidden");
    return;
  }

  els.repoEmptyState.classList.add("hidden");
  els.repoManager.classList.remove("hidden");
  els.selectedWorkspaceTitle.textContent = state.selectedWorkspace.name;
  els.selectedWorkspaceSlug.textContent = state.selectedWorkspace.slug;

  const repos = payload.repositories || [];
  if (!repos.length) {
    els.repoList.innerHTML = `<div class="empty-state">Nenhum repositorio nesse workspace.</div>`;
    return;
  }

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
        ${repos.map((repo) => `
          <tr>
            <td>
              <strong>${escapeHtml(repo.name)}</strong><br>
              <span class="muted-text">${escapeHtml(repo.url)}</span>
            </td>
            <td><span class="status-pill ${repo.status === "active" ? "online" : repo.status === "error" ? "offline" : "warning"}">${escapeHtml(repo.status)}</span></td>
            <td>${escapeHtml(repo.default_branch || "-")}</td>
            <td><code>${escapeHtml(repo.local_path || "-")}</code></td>
            <td><button class="danger-button" data-delete-repo="${repo.id}">Remover</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderMcp() {
  els.mcpBaseUrl.textContent = state.mcp.base_url || "-";
  els.mcpConfigExample.textContent = `[mcp_servers.company]
url = "${state.mcp.base_url || "http://<IP_DO_SERVIDOR>:7000"}"
headers = { "x-api-key" = "<GATEWAY_API_KEY>" }`;

  els.toolList.innerHTML = state.mcp.tools.length
    ? state.mcp.tools.map((tool) => `<span>${escapeHtml(tool)}</span>`).join("")
    : `<div class="empty-state">Nenhuma tool disponivel ou Gateway indisponivel.</div>`;

  els.toolSelect.innerHTML = state.mcp.tools.length
    ? state.mcp.tools.map((tool) => `<option value="${tool}">${escapeHtml(tool)}</option>`).join("")
    : `<option value="">Sem tools</option>`;
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
  }
  renderWorkspaces();
}

async function loadMcp() {
  state.mcp = await api("/api/mcp");
  renderMcp();
}

async function selectWorkspace(slug) {
  const workspace = state.workspaces.find((item) => item.slug === slug);
  if (!workspace) {
    return;
  }

  state.selectedWorkspace = workspace;
  renderWorkspaces();
  const repos = await api(`/api/workspaces/${encodeURIComponent(slug)}/repositories`);
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

document.addEventListener("click", async (event) => {
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
    } else {
      window.open(service.url, "_blank", "noopener,noreferrer");
    }
    return;
  }

  const workspaceItem = event.target.closest("[data-workspace]");
  if (workspaceItem) {
    await selectWorkspace(workspaceItem.dataset.workspace);
    return;
  }

  const deleteRepoButton = event.target.closest("[data-delete-repo]");
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
    const owner = els.githubOwner.value.trim();
    const data = await api(`/api/git/repositories${owner ? `?owner=${encodeURIComponent(owner)}` : ""}`);
    state.remoteRepos = data.repositories || [];
    els.remoteRepoSelect.innerHTML = [
      `<option value="">Selecionar repo listado ou informar manualmente</option>`,
      ...state.remoteRepos.map((repo, index) => `<option value="${index}">${escapeHtml(repo.full_name)} (${escapeHtml(repo.default_branch)})</option>`)
    ].join("");
    toast(`${state.remoteRepos.length} repositorios carregados.`);
  } catch (error) {
    toast(error.message);
  } finally {
    els.loadGithubRepos.disabled = false;
    els.loadGithubRepos.textContent = "Listar GitHub";
  }
});

els.remoteRepoSelect.addEventListener("change", () => {
  const repo = state.remoteRepos[Number(els.remoteRepoSelect.value)];
  if (!repo) {
    return;
  }
  els.repoName.value = repo.name;
  els.repoUrl.value = repo.url;
  els.repoBranch.value = repo.default_branch || "main";
});

els.repoForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.selectedWorkspace) {
    toast("Selecione um workspace.");
    return;
  }

  try {
    const button = els.repoForm.querySelector("button");
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
    toast("Repositorio clonado e registrado.");
    await loadWorkspaces();
    await selectWorkspace(state.selectedWorkspace.slug);
  } catch (error) {
    toast(error.message);
  } finally {
    const button = els.repoForm.querySelector("button");
    button.disabled = false;
    button.textContent = "Adicionar e clonar";
  }
});

els.toolTestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = JSON.parse(els.toolPayload.value || "{}");
    const workspaceSlug = els.toolWorkspaceSelect.value;
    if (workspaceSlug && !payload.workspace_slug && !payload.workspace_id) {
      payload.workspace_slug = workspaceSlug;
    }

    els.toolResponse.textContent = "Executando...";
    const data = await api("/api/mcp/test", {
      method: "POST",
      body: JSON.stringify({
        tool: els.toolSelect.value,
        payload
      })
    });
    els.toolResponse.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    els.toolResponse.textContent = error.message;
  }
});

window.addEventListener("popstate", () => {
  routeTo(routeFromPath());
});

els.adminKey.value = localStorage.getItem("adminApiKey") || "";
routeTo(routeFromPath());
refreshAll();
