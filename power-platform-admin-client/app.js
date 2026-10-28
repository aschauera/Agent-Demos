import {
  API_REFERENCE,
  NAVIGATION_MODULES,
  APPLICATION_MODULE,
  ENVIRONMENTS_LIST,
  PERMISSIONS_REFERENCE,
  getSectionById
} from "./api-catalog.js";
import {
  extractNextLink,
  extractRows,
  getApiErrorDescription,
  pollAcceptedOperation as pollApiOperation,
  requestNextPage as requestApiNextPage,
  requestPowerPlatformApi as requestApi
} from "./api-client.js";
import { beginAuthorization, completeAuthorization, clearAuthorizationFlow } from "./auth.js";
import { bindConsumption, consumptionMarkup } from "./consumption.js";
import { createAppManagementState, mountAppManagement } from "./app-management.js";
import { connectionPresentation, createMockFetch, mockConsumption } from "./session-mode.js";
import { appView, createInventoryState, inventoryMarkup, loadInventory } from "./application-inventory.js";
import { loadApplicationSummary, loadCopilotSummary, loadModuleSummary } from "./module-summary.js";
import { connectionIds, readLocalConnection, saveLocalConnection, forgetLocalConnection } from "./local-settings.js";
import { agentKey, agentDetailsMarkup, agentOperationFields, agentOperationRequest } from "./agent-details.js";
import { KPI_BUCKETS, loadTenantOverview } from "./tenant-overview.js";
import { barChart, donutChart } from "./charts.js";

let disposeConsumption;
let disposeAppManagement;
let agentDownloadUrl;

const state = {
  mode: "live",
  summaries: new Map(),
  token: undefined,
  tokenExpiresAt: undefined,
  currentSectionId: undefined,
  lastResult: undefined,
  lastError: undefined,
  requestLog: [],
  activeController: undefined,
  toastTimer: undefined
};
state.appManagement = createAppManagementState();
state.inventory = createInventoryState();
const mockFetch = createMockFetch();
const sessionToken = () => state.mode === "mock" ? "local-mock-only" :
  connectionPresentation(state.mode, state.token, state.tokenExpiresAt).connected ? state.token : undefined;
const sessionOptions = (options) => ({
  ...options, accessToken: sessionToken(), fetchImpl: state.mode === "mock" ? mockFetch : fetch
});
const loadingActivities = new Map();
function updateLoadingIndicator() {
  const labels = [...loadingActivities.values()]
    .filter((activity) => activity.sectionId === state.currentSectionId).map((activity) => activity.label);
  const banner = document.querySelector("#module-loading");
  banner.classList.toggle("hidden", labels.length === 0);
  document.querySelector("#module-loading-message").textContent = [...new Set(labels)].join(" · ");
  document.querySelector("#main-content").setAttribute("aria-busy", String(labels.length > 0));
}

function beginLoading(label, sectionId = state.currentSectionId) {
  const key = Symbol();
  loadingActivities.set(key, { label, sectionId });
  updateLoadingIndicator();
  return () => {
    loadingActivities.delete(key);
    updateLoadingIndicator();
  };
}

async function loadingRequest(request, options) {
  const finish = beginLoading("Requesting Power Platform data…");
  try {
    return await request(sessionOptions(options));
  } finally {
    finish();
  }
}
const requestPowerPlatformApi = (options) => loadingRequest(requestApi, options);
const requestNextPage = (options) => loadingRequest(requestApiNextPage, options);
const pollAcceptedOperation = (options) => loadingRequest(pollApiOperation, options);

const content = document.querySelector("#main-content");
const nav = document.querySelector("#navigation");
const connectDialog = document.querySelector("#connect-dialog");
const detailDialog = document.querySelector("#detail-dialog");
const config = {
  tenantId: window.PP_ADMIN_CONFIG?.tenantId ?? "",
  clientId: window.PP_ADMIN_CONFIG?.clientId ?? "",
  scope: window.PP_ADMIN_CONFIG?.scope ?? "https://api.powerplatform.com/.default"
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function formatValue(value) {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "object") {
    return Array.isArray(value) ? `${value.length} items` : "[object]";
  }
  return String(value);
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.add("hidden"), 4600);
}

function setConnectionStatus() {
  const status = document.querySelector("#connection-status");
  const { connected, label, description } = connectionPresentation(state.mode, state.token, state.tokenExpiresAt);
  status.classList.toggle("connected", connected);
  status.innerHTML = `<span class="status-dot"></span>${escapeHtml(label)}`;
  document.querySelector("#session-mode").value = state.mode;
  document.querySelector("#session-description").textContent = description;
  document.querySelector("#connect-button").classList.toggle("hidden", connected || state.mode === "mock");
  document.querySelector("#disconnect-button").classList.toggle("hidden", !connected);
}

function navMarkup() {
  const dashboardClass = state.currentSectionId ? "" : "active";
  return [
    `<a class="nav-link dashboard-link ${dashboardClass}" href="#dashboard"><span class="nav-icon">⌂</span>Tenant overview</a>`,
    ...NAVIGATION_MODULES.map((section, index) => {
      const activeClass = state.currentSectionId === section.id ? "active" : "";
      return `<a class="nav-link ${activeClass}" href="#section/${escapeHtml(section.id)}"><span class="nav-icon">${String(index + 1).padStart(2, "0")}</span>${escapeHtml(section.title)}</a>`;
    })
  ].join("");
}

function updateNavigation() {
  nav.innerHTML = navMarkup();
  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      const route = link.getAttribute("href");
      if (route === "#dashboard") {
        state.currentSectionId = undefined;
      } else {
        state.currentSectionId = route.slice("#section/".length);
      }
      render();
    });
  });
}

function statCard(label, value, note, accent = "cyan") {
  return `<div class="stat-card"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value accent-${accent}">${escapeHtml(value)}</div><div class="stat-note">${escapeHtml(note)}</div></div>`;
}

function copilotTiles(data) {
  const tiles = [
    ["total", "Total agents", data?.rows.length],
    ["github", "GitHub Copilot Harness", data?.github],
    ["standard", "Standard", data?.standard],
    ["chat", "Copilot Chat", data?.chat],
    ["unknown", "Unknown harness", data?.unknown]
  ];
  return `<div class="stats-grid">${tiles.map(([kind, title, value]) =>
    `<div class="stat-card harness-tile harness-${kind}">
      <div class="stat-label">${title}</div>
      ${kind === "github" ? `<button type="button" class="credits-badge" aria-label="Uses Copilot Credits" aria-describedby="harness-credits-tooltip">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="4" width="16" height="12" rx="2"/><circle cx="10" cy="10" r="3"/><path d="M5 10h1m8 0h1"/></svg>
        <span class="credits-tooltip" id="harness-credits-tooltip" role="tooltip">Agents using this harness use Copilot Credits.</span>
      </button>` : ""}
      <div class="stat-value">${escapeHtml(value ?? "—")}</div>
    </div>`).join("")}</div>`;
}

const DASHBOARD_SUMMARY = "dashboard";
const RESOURCE_QUERY_HINT = "Requires delegated ResourceQuery.Resources.Read and service-side inventory access.";

function kpiTile(label, value, note, href, accent = "cyan") {
  const inner = `<div class="stat-label">${escapeHtml(label)}</div><div class="stat-value accent-${accent}">${escapeHtml(value)}</div><div class="stat-note">${escapeHtml(note)}</div>`;
  return href ? `<a class="stat-card kpi-link" href="${escapeHtml(href)}">${inner}</a>` : `<div class="stat-card">${inner}</div>`;
}

function chartPanel(title, chart, body, { inventory = true, wide = false } = {}) {
  let markup;
  if (!chart || chart.status === "pending") markup = '<p class="chart-empty">Waiting…</p>';
  else if (chart.status === "loading") markup = '<p class="chart-empty" role="status"><span class="chart-spinner" aria-hidden="true"></span>Loading…</p>';
  else if (chart.status === "error") markup = `<div class="request-error" role="alert">${escapeHtml(chart.error)}</div>${inventory ? `<p class="form-hint">${RESOURCE_QUERY_HINT}</p>` : ""}`;
  else markup = body(chart.data);
  return `<section class="panel chart-panel${wide ? " chart-wide" : ""}"><div class="panel-title"><h3>${escapeHtml(title)}</h3></div>${markup}</section>`;
}

const shortId = (id) => (id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id);

function renderTenantOverview() {
  const container = content.querySelector("#tenant-overview");
  if (!container) return;
  const entry = state.summaries.get(DASHBOARD_SUMMARY);
  const charts = entry?.data || {};
  const kpis = charts.types?.status === "done" ? charts.types.data.kpis : undefined;
  const kpiNote = !entry ? "Connect to load" : kpis ? "Tenant inventory" : charts.types?.status === "error" ? "Unavailable" : "Loading…";
  const value = (id) => (kpis ? kpis[id].toLocaleString() : "—");
  let markup = `<div class="stats-grid kpi-grid">
    ${kpiTile("Total resources", value("total"), kpiNote, undefined, "violet")}
    ${KPI_BUCKETS.map((bucket) => kpiTile(bucket.label, value(bucket.id), kpiNote, `#section/${bucket.sectionId}`)).join("")}
  </div>`;
  if (!entry) {
    container.innerHTML = `${markup}<p class="notice">Connect to the tenant to load the tenant overview automatically.</p>`;
    return;
  }
  const names = new Map(charts.environmentList?.data?.names || []);
  const environmentHref = "#section/environment-management";
  markup += `<div class="chart-grid">
    ${chartPanel("Top environments by resources", charts.environments, (rows) => barChart({
      label: "Top 10 environments by resource count",
      items: rows.map(({ key, count }) => {
        const name = names.get(key.toLowerCase());
        return { label: name || shortId(key), value: count, href: environmentHref, tooltip: `${name ? `${name} · ` : ""}${key}: ${count}` };
      })
    }))}
    ${chartPanel("Resources by region", charts.regions, (rows) => donutChart({
      label: "Resources by region", centerLabel: "resources",
      items: rows.map(({ key, count }) => ({ label: key, value: count }))
    }))}
    ${chartPanel("Agents by harness", charts.harness, (data) => donutChart({
      label: "Copilot Studio agents by harness", centerLabel: "agents", emptyText: "No agents returned by the inventory.",
      items: [["GitHub Copilot", data.github, 0], ["Standard", data.standard, 1], ["Copilot Chat", data.chat, 2], ["Unknown", data.unknown, 5]]
        .map(([label, count, color]) => ({ label, value: count, color, href: "#section/copilot-studio" }))
    }))}
    ${chartPanel("Environments by type", charts.environmentList, (data) => `<div class="chart-pair">${barChart({
      label: "Environments by type", emptyText: "No accessible environments.",
      items: data.byType.map(({ key, count }) => ({ label: key, value: count, href: environmentHref }))
    })}${donutChart({
      label: "Managed Environments", centerLabel: "environments", emptyText: "No accessible environments.",
      items: data.byProtection.map(({ key, count }) => ({ label: key, value: count, href: environmentHref,
        color: { Managed: 1, "Not managed": 3, Unknown: 5 }[key] }))
    })}</div>`, { inventory: false })}
    ${chartPanel("Top owners by items", charts.owners, (rows) => barChart({
      label: "Top 10 owners by item count", emptyText: "No owner metadata returned.",
      items: rows.map(({ key, count }) => ({ label: key, value: count, copy: key, tooltip: `Entra object ID ${key}: ${count}` }))
    }), { wide: true })}
  </div>`;
  const failed = Object.values(charts).some((chart) => chart.status === "error");
  markup += `<p class="form-hint">Inventory aggregates are computed server-side by the Resource Query API (summarize count). Inventory changes typically appear within 20 minutes; V1 agents are not tracked. Owners are Microsoft Entra object IDs.</p>`;
  if (entry.error) markup += `<div class="request-error" role="alert">${escapeHtml(entry.error)}</div>`;
  markup += `<p class="form-hint" role="status">${entry.status === "loading" ? "Loading tenant overview…" : entry.error || failed ? "Overview incomplete; unavailable charts are marked above. Refresh to retry." : "Tenant overview loaded. Refresh for current data."}</p>
    <div class="overview-actions">
      <button id="refresh-tenant-overview" class="button button-quiet" ${entry.status === "loading" ? "disabled" : ""}>Refresh overview</button>
      ${entry.status === "loading" ? '<button id="cancel-tenant-overview" class="button button-danger">Cancel</button>' : ""}
    </div>`;
  container.innerHTML = markup;
  container.querySelector("#refresh-tenant-overview").addEventListener("click", () => {
    state.summaries.delete(DASHBOARD_SUMMARY);
    ensureTenantOverview();
  });
  container.querySelector("#cancel-tenant-overview")?.addEventListener("click", () => entry.controller.abort());
  container.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      showToast("Owner ID copied.");
    } catch {
      showToast("Clipboard unavailable; select the ID to copy it manually.");
    }
  }));
}

function ensureTenantOverview() {
  if (!sessionToken() || state.summaries.has(DASHBOARD_SUMMARY)) { renderTenantOverview(); return; }
  const entries = state.summaries;
  const entry = { status: "loading", controller: new AbortController() };
  entries.set(DASHBOARD_SUMMARY, entry);
  const finishLoading = beginLoading("Loading tenant overview…", undefined);
  const copilot = entries.get("copilot-studio");
  const copilotSummary = copilot?.status === "done" && !copilot.error ? copilot.data : undefined;
  const update = () => { if (state.summaries === entries && !state.currentSectionId) renderTenantOverview(); };
  renderTenantOverview();
  void loadTenantOverview(sessionOptions({ signal: entry.controller.signal }), (data) => { entry.data = data; update(); }, { copilotSummary })
    .then((data) => { entry.data = data; }, (error) => {
      entry.error = error.name === "AbortError" ? "Overview cancelled. Refresh to retry." : getApiErrorDescription(error);
    }).finally(() => { entry.status = "done"; finishLoading(); update(); });
}

function renderDashboard() {
  content.innerHTML = `
    <div class="hero">
      <div class="hero-tag">POWER PLATFORM · TENANT MANAGEMENT</div>
      <h1>One workspace for your platform.</h1>
      <p>Tenant-wide totals and resource distribution from the Power Platform inventory, with drilldown into each management module.</p>
    </div>
    <section id="tenant-overview" aria-label="Tenant overview"></section>
    <div class="section-heading"><div><h2>Management modules</h2><p>Documented APIs grouped by management task.</p></div><a class="button button-quiet button-small" href="${API_REFERENCE}" target="_blank" rel="noreferrer">Microsoft Learn ↗</a></div>
    <div class="section-grid">${NAVIGATION_MODULES.map((section, index) => sectionCard(section, index)).join("")}</div>`;
  ensureTenantOverview();
}

function sectionCard(section, index) {
  return `<a class="section-card" href="#section/${escapeHtml(section.id)}"><div class="section-card-top"><span class="card-orbit">${String(index + 1).padStart(2, "0")}</span><span class="permission-count">${section.operationCount} operations</span></div><h3>${escapeHtml(section.title)}</h3><p>${escapeHtml(section.description)}</p></a>`;
}

function renderPermissionList(section) {
  if (!section.permissions.length) {
    return `<div class="notice">This section has no matching granular scope in the current permission-reference list. Check the Security section of each operation page for the required permission.</div>`;
  }
  return `<div class="permission-list">${section.permissions.map((permission) => `<span class="permission-chip">${escapeHtml(permission)}</span>`).join("")}</div>`;
}

function renderRequestForm(section) {
  const knownOperation = section.id === "environment-management" ? ENVIRONMENTS_LIST : undefined;
  const routePlaceholder = knownOperation
    ? "environments"
    : "resource path from the API operation reference";
  const version = knownOperation?.apiVersion ?? "";
  const defaultMethod = knownOperation?.method ?? "GET";
  return `
    <form id="api-request-form" class="request-form">
      <div class="field method-field">
        <label for="request-method">HTTP method</label>
        <select id="request-method" name="method">
          ${["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => `<option ${method === defaultMethod ? "selected" : ""}>${method}</option>`).join("")}
        </select>
      </div>
      <div class="field path-field">
        <label for="request-path">Resource path under /${escapeHtml(section.namespace.toLowerCase())}/</label>
        <input id="request-path" name="path" value="${escapeHtml(knownOperation?.path ?? "")}" placeholder="${escapeHtml(routePlaceholder)}" required autocomplete="off" spellcheck="false">
      </div>
      <div class="field version-field">
        <label for="api-version">API version</label>
        <input id="api-version" name="apiVersion" value="${escapeHtml(version)}" placeholder="Use the operation's version" required autocomplete="off" spellcheck="false">
      </div>
      <div class="field body-field">
        <label for="request-body">JSON body (POST, PUT, PATCH)</label>
        <textarea id="request-body" name="body" placeholder='{"property":"value"}'></textarea>
      </div>
      <div class="submit-row">
        <span id="request-status" class="form-hint">${state.mode === "mock" ? "Local sample data only; no tenant requests." : sessionToken() ? "Request will go directly to api.powerplatform.com." : "Connect with delegated access before calling an API."}</span>
        <div class="request-actions">
          <button id="cancel-request" type="button" class="button button-danger button-small hidden">Cancel request</button>
          <button id="run-request" type="submit" class="button button-primary" ${sessionToken() ? "" : "disabled"}>Run API request</button>
        </div>
      </div>
    </form>`;
}

function renderOperationCatalog(section) {
  if (!section.resourceGroups.length) {
    return `<div class="empty-state"><strong>No resource groups in the current index</strong>Open the official reference to verify the latest API coverage.</div>`;
  }
  return section.resourceGroups.map((resource, resourceIndex) => {
    const operationLinks = resource.operations.length
      ? `<ul class="operation-list">${resource.operations.map((operation, operationIndex) => `
          <li>
            <a href="${escapeHtml(operation.docsUrl)}" target="_blank" rel="noreferrer">${escapeHtml(operation.title)} <span>↗</span></a>
            <button type="button" class="button button-quiet button-small use-operation" data-resource-index="${resourceIndex}" data-operation-index="${operationIndex}" ${operation.method && typeof operation.path === "string" && operation.apiVersion ? "" : "disabled"}>Use</button>
          </li>`).join("")}</ul>`
      : `<div class="form-hint">No individual operation pages are listed for this resource group.</div>`;
    const overviewLink = resource.docsUrl
      ? `<a class="resource-overview-link" href="${escapeHtml(resource.docsUrl)}" target="_blank" rel="noreferrer">Resource overview ↗</a>`
      : "";
    return `
      <details class="resource-group">
        <summary><span>${escapeHtml(resource.title)}</span><small>${resource.operations.length} operations</small></summary>
        <div class="resource-group-content">${overviewLink}${operationLinks}</div>
      </details>`;
  }).join("");
}

function resultMarkup(result) {
  if (!result) {
    return `<div class="empty-state"><strong>No response yet</strong>Run a documented operation from this namespace. Request paths are constrained to the selected API section.</div>`;
  }
  const rows = extractRows(result.data);
  const raw = escapeHtml(JSON.stringify(result.data, null, 2) ?? "No response body");
  const location = result.headers?.get("location");
  const nextLink = extractNextLink(result.data);
  let contentMarkup = `<pre class="json-view">${raw}</pre>`;
  const objectRows = rows.filter((row) => row && typeof row === "object" && !Array.isArray(row));
  if (objectRows.length) {
    const columns = Object.keys(objectRows[0]).filter((key) => !key.startsWith("@")).slice(0, 6);
    contentMarkup = `
      <div class="table-wrap">
        <table>
          <thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
          <tbody>${rows.slice(0, 100).map((row, rowIndex) => `<tr data-result-index="${rowIndex}">${columns.map((column) => `<td>${escapeHtml(formatValue(row?.[column]))}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
      <p class="form-hint">${rows.length > 100 ? "Showing the first 100 rows." : `${rows.length} row(s) in this response.`} Select a row to inspect its detail.</p>`;
  }
  return `
    <div class="panel-title"><h3>API response</h3><span class="result-meta"><span class="ok">HTTP ${escapeHtml(result.status)}</span><span>${escapeHtml(result.url)}</span></span></div>
    ${location ? `<p class="form-hint">Response Location: <span class="mono">${escapeHtml(location)}</span></p>` : ""}
    ${nextLink ? '<p class="form-hint">This response includes a server-provided OData next link.</p><div class="next-page-row"><button id="load-next-api-page" class="button button-quiet button-small">Load next page</button></div>' : ""}
    ${contentMarkup}`;
}

function renderSection(section) {
  if (section.id === "app-management") {
    disposeAppManagement = mountAppManagement(content, {
      state: state.appManagement, accessToken: sessionToken(), showDetail, recordRequest,
      beginLoading,
      fetchImpl: state.mode === "mock" ? mockFetch : fetch, autoLoad: Boolean(sessionToken())
    });
    return;
  }
  const responseRows = state.lastResult?.sectionId === section.id
    ? extractRows(state.lastResult.response.data).length
    : 0;
  const sectionError = state.lastError?.sectionId === section.id
    ? `<div class="request-error">${escapeHtml(state.lastError.message)}</div>`
    : undefined;
  content.innerHTML = `
    <div class="hero">
      <div class="hero-tag">${escapeHtml(section.namespace.toUpperCase())} NAMESPACE</div>
      <h1>${escapeHtml(section.title)}</h1>
      <p>${escapeHtml(section.description)} Use exact paths and API versions from the operation reference; this client does not infer or fabricate endpoints.</p>
    </div>
    <div class="stats-grid">
      ${statCard("Requests in session", String(state.requestLog.filter((item) => item.sectionId === section.id).length), "This browser session only", "cyan")}
      ${statCard("Resource groups", String(section.resourceGroupCount), "Indexed from Microsoft Learn", "violet")}
      ${statCard("Documented operations", String(section.operationCount), "Open a reference for exact route and version", "green")}
      ${statCard("Rows in latest response", String(responseRows), "Loaded API data held in memory", "violet")}
    </div>
    <div class="section-heading"><div><h2>Section overview</h2><p>API summaries are computed only from data returned in this session.</p></div><a class="button button-quiet button-small" href="${API_REFERENCE}" target="_blank" rel="noreferrer">Open API reference ↗</a></div>
    ${section.id === "licensing" ? consumptionMarkup() : ""}
    <section class="panel operation-catalog">
      <div class="panel-title"><h3>Resources and operations</h3><span>${section.resourceGroupCount} resource groups · ${section.operationCount} operations</span></div>
      ${renderOperationCatalog(section)}
    </section>
    <div class="section-heading"><div><h2>Run a documented operation</h2><p>Copy the exact relative route, HTTP method, request body, and API version from its operation page.</p></div></div>
    <div class="dashboard-grid">
      <section class="panel">
        <div class="panel-title"><h3>API operation</h3><span>Namespace-bound request</span></div>
        <div class="notice warning">Use a route documented for this namespace and its exact API version. Write and action requests require confirmation; the signed-in user's access is still enforced by the service.</div>
        <div class="form-spacer"></div>
        ${renderRequestForm(section)}
      </section>
      <section class="panel">
        <div class="panel-title"><h3>Permissions</h3><span>Documented granular scopes</span></div>
        ${renderPermissionList(section)}
        <p class="form-hint permission-hint">The token request uses the app registration's configured delegated permissions via <span class="mono">.default</span>. Admin consent and the signed-in user's service-side role remain required.</p>
        <a class="button button-quiet button-small" href="${PERMISSIONS_REFERENCE}" target="_blank" rel="noreferrer">Permission reference ↗</a>
      </section>
    </div>
    <div class="section-heading"><div><h2>Detail view</h2><p>Responses are not written to disk or browser storage.</p></div></div>
    <section id="result-panel" class="panel">${sectionError ?? resultMarkup(state.lastResult?.sectionId === section.id ? state.lastResult.response : undefined)}</section>`;

  const selectedAgentKey = agentRouteKey();
  const selectedAgent = section.id === "copilot-studio" && selectedAgentKey
    ? state.summaries.get("copilot-studio")?.data?.rows.find((row) => agentKey(row) === selectedAgentKey) : undefined;
  if (section.id === "copilot-studio" && selectedAgentKey) {
    content.querySelector(".hero").remove();
    content.querySelector(".stats-grid").remove();
    content.querySelector(".section-heading").remove();
    content.querySelector(".operation-catalog").remove();
    const overview = document.createElement("div");
    overview.id = "agent-details";
    overview.innerHTML = selectedAgent ? agentDetailsMarkup(selectedAgent, section) :
      '<a class="button button-quiet" href="#section/copilot-studio">Back to agents</a><p class="notice" role="status">Agent metadata is not available in the current inventory. Connect and load the inventory, or return to the agent list.</p>';
    content.prepend(overview);
    overview.querySelector(".agent-metadata")?.addEventListener("submit", (event) => event.preventDefault());
    const requestGrid = content.querySelector(".dashboard-grid");
    requestGrid.previousElementSibling.remove();
    requestGrid.remove();
    content.querySelector("#result-panel").previousElementSibling.querySelector("h2").textContent = "Operation result";
    overview.querySelectorAll(".agent-operation").forEach((button) => {
      const operation = section.resourceGroups[Number(button.dataset.resourceIndex)].operations[Number(button.dataset.operationIndex)];
      const mutation = operation.method !== "GET";
      button.disabled = !sessionToken() || Boolean(state.activeController) || (state.mode === "mock" && mutation);
      if (state.mode === "mock" && mutation) button.title = "Mock mode is read-only. Connect to a live tenant for management actions.";
      button.addEventListener("click", () => void runAgentOperation(operation, selectedAgent));
    });
    const cancel = overview.querySelector("#cancel-agent-operation");
    if (cancel) {
      cancel.disabled = !state.activeController;
      cancel.addEventListener("click", () => state.activeController?.abort());
    }
  }
  content.querySelector("#api-request-form")?.addEventListener("submit", (event) => runSectionRequest(event, section));
  if (section.id === "licensing") {
    disposeConsumption = bindConsumption(content, {
      tenantId: config.tenantId,
      beginLoading,
      ...(state.mode === "mock" ? { request: mockConsumption, mock: true } : {})
    });
  }
  content.querySelector("#cancel-request")?.addEventListener("click", () => state.activeController?.abort());
  content.querySelectorAll(".use-operation").forEach((button) => {
    button.addEventListener("click", () => {
      const operation = section.resourceGroups[Number(button.dataset.resourceIndex)]
        ?.operations[Number(button.dataset.operationIndex)];
      if (!operation?.method || typeof operation.path !== "string" || !operation.apiVersion) {
        showToast("This operation has no resolved request template. Open its Microsoft Learn reference.");
        return;
      }

      const form = content.querySelector("#api-request-form");
      form.elements.method.value = operation.method;
      form.elements.path.value = operation.path;
      form.elements.apiVersion.value = operation.apiVersion;
      form.elements.body.value = "";
      form.querySelector("#request-status").textContent =
        "Documented template loaded. Replace any {parameter} placeholders and enter the documented JSON body before sending.";
      form.scrollIntoView({ behavior: "smooth", block: "center" });
      form.elements.path.focus();
    });
  });
  content.querySelectorAll("[data-result-index]").forEach((row) => {
    const rows = extractRows(state.lastResult?.response?.data);
    row.addEventListener("click", () => showDetail("API resource", rows[Number(row.dataset.resultIndex)]));
  });
  content.querySelector("#load-next-api-page")?.addEventListener("click", () => {
    void loadNextSectionPage(section);
  });
  if (section.id === "copilot-studio" && !selectedAgentKey) {
    content.querySelector(".hero-tag").textContent = "Manage your agents";
    content.querySelector(".stats-grid").outerHTML = '<section id="module-summary" aria-label="Agent inventory overview"></section>';
    content.querySelector(".hero p").textContent =
      "Discover agents across accessible tenant environments, inspect harness metadata, and run documented Copilot Studio operations.";
    content.querySelector(".section-heading p").textContent =
      "Agent inventory loads automatically through the read-only Resource Query API.";
  }
}

function agentRouteKey() {
  const [, module, subpage, ...key] = window.location.hash.slice(1).split("/");
  if (module !== "copilot-studio" || subpage !== "agent") return undefined;
  try {
    return decodeURIComponent(key.join("/")) || undefined;
  } catch {
    return "invalid-agent-route";
  }
}

function requestAgentOperationInputs(operation, row) {
  const fields = agentOperationFields(operation, row);
  if (!fields.length && operation.method === "GET") return Promise.resolve({});
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.id = "agent-operation-dialog";
    dialog.className = "dialog";
    dialog.setAttribute("aria-labelledby", "agent-operation-title");
    dialog.innerHTML = `<form id="agent-operation-form">
      <h2 id="agent-operation-title">${escapeHtml(operation.title)}</h2>
      <p>Agent: <strong>${escapeHtml(row.properties.displayName || row.agent.name)}</strong><br>
      Environment: ${escapeHtml(row.properties.environmentId || row.agent.environmentId || "Enter below")}</p>
      ${operation.method !== "GET" ? `<p class="notice warning">${operation.method === "DELETE" ? "This deletes the agent." : "This action can change the agent or start a service operation."} Confirm only if this is intended. Cancelling an HTTP request does not undo submitted changes.</p>` : ""}
      ${fields.map((field) => `<label for="agent-action-${field.name}">${escapeHtml(field.label)}</label>
        ${field.choices ? `<select id="agent-action-${field.name}" name="${field.name}" ${field.required ? "required" : ""}>
          ${field.choices.map((value, index) => `<option value="${value}">${escapeHtml(field.choiceLabels?.[index] ?? (value === "true" ? "Yes" : value === "false" ? "No" : value || "Select…"))}</option>`).join("")}</select>` :
          `<input id="agent-action-${field.name}" name="${field.name}" ${field.required ? "required" : ""} autocomplete="off">`}`).join("")}
      <p><a href="${escapeHtml(operation.docsUrl)}" target="_blank" rel="noreferrer">Operation reference</a></p>
      <div id="agent-operation-error" class="inline-error hidden" role="alert"></div>
      <div class="dialog-actions"><button type="button" class="button button-quiet" id="cancel-agent-action">Cancel</button>
        <button type="submit" class="button ${operation.method === "GET" ? "button-primary" : "button-danger"}">${operation.method === "GET" ? "Run operation" : "Confirm and run"}</button></div>
      </form>`;
    document.body.append(dialog);
    let result;
    dialog.addEventListener("close", () => { dialog.remove(); resolve(result); }, { once: true });
    dialog.querySelector("#cancel-agent-action").addEventListener("click", () => dialog.close());
    dialog.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const inputs = Object.fromEntries(new FormData(event.target));
      try {
        agentOperationRequest(operation, row, inputs);
        result = inputs;
        dialog.close();
      } catch (error) {
        const message = dialog.querySelector("#agent-operation-error");
        message.textContent = error.message;
        message.classList.remove("hidden");
      }
    });
    dialog.showModal();
  });
}

async function runAgentOperation(operation, row) {
  if (state.activeController) { showToast("Cancel the active request first."); return; }
  const route = window.location.hash;
  const inputs = await requestAgentOperationInputs(operation, row);
  if (!inputs || route !== window.location.hash) return;
  if (!sessionToken() || state.activeController) { showToast("Connect to the tenant and finish any active request first."); return; }
  const section = getSectionById("copilot-studio");
  const controller = new AbortController();
  state.activeController = controller;
  state.lastError = undefined;
  state.lastResult = undefined;
  content.querySelector("#result-panel").innerHTML =
    `<p class="form-hint" role="status">${escapeHtml(operation.title)} is running…</p>`;
  const finish = beginLoading(`${operation.title}…`);
  content.querySelectorAll(".agent-operation").forEach((button) => { button.disabled = true; });
  content.querySelector("#cancel-agent-operation").disabled = false;
  let download;
  try {
    const response = await requestPowerPlatformApi({
      section, ...agentOperationRequest(operation, row, inputs), signal: controller.signal
    });
    controller.signal.throwIfAborted();
    if (route !== window.location.hash) return;
    if (response.data instanceof Blob) {
      download = response.data;
      state.lastResult = { sectionId: section.id, response: {
        ...response, data: { fileName: `${operation.id}.zip`, bytes: download.size }
      } };
    } else {
      state.lastResult = { sectionId: section.id, response };
    }
    state.lastError = undefined;
    recordRequest(section, response);
    showToast(response.status === 202 ? "Request accepted; the service operation is not yet complete." :
      `${operation.title}: HTTP ${response.status}.${operation.id === "run-maker-evaluation-test-set" ? " Inspect the returned evaluation state; the run may still be in progress." : ""}`);
  } catch (error) {
    if (route === window.location.hash && !controller.signal.aborted) {
      state.lastError = { sectionId: section.id, message: getApiErrorDescription(error) };
      recordRequest(section, undefined, error);
    } else if (controller.signal.aborted) {
      if (route === window.location.hash && state.activeController === controller) {
        state.lastError = { sectionId: section.id, message: "Request cancelled. Submitted service operations may still continue." };
      }
      showToast("Request cancelled. Submitted service operations may still continue.");
    }
  } finally {
    if (state.activeController === controller) state.activeController = undefined;
    finish();
    render();
  }
  if (download && route === window.location.hash && !controller.signal.aborted) {
    agentDownloadUrl = URL.createObjectURL(download);
    const link = document.createElement("a");
    link.href = agentDownloadUrl;
    link.download = `${operation.id}.zip`;
    link.className = "button button-primary";
    link.textContent = "Download ZIP";
    content.querySelector("#result-panel").append(link);
    link.click();
  }
}

function renderApplicationModule() {
  const inventory = state.inventory;
  const view = appView(inventory.view);
  const section = getSectionById(view.sectionId);
  renderSection(section);
  content.querySelector(".hero")?.remove();
  content.querySelector(".stats-grid")?.remove();
  content.querySelector(".section-heading")?.remove();
  const overview = document.createElement("div");
  overview.innerHTML = inventoryMarkup(inventory, Boolean(sessionToken()), Boolean(state.activeController));
  content.prepend(overview);
  const remember = () => {
    inventory.environmentId = overview.querySelector("#inventory-environment").value;
    inventory.search = overview.querySelector("#inventory-search").value;
  };
  overview.querySelectorAll("[data-app-view]").forEach((button) => {
    button.addEventListener("click", () => {
      remember();
      inventory.view = button.dataset.appView;
      render();
    });
  });
  overview.querySelector("#inventory-search").addEventListener("input", () => {
    remember();
    const position = overview.querySelector("#inventory-search").selectionStart;
    render();
    const input = content.querySelector("#inventory-search");
    input.focus();
    input.setSelectionRange(position, position);
  });
  const key = view.sectionId === "power-pages" ? "websites" : "apps";
  async function runInventory(next = false, detailIndex) {
    if (state.activeController) {
      showToast("Cancel the active request first.");
      return;
    }
    remember();
    inventory.error = undefined;
    const controller = new AbortController();
    state.activeController = controller;
    render();
    try {
      if (!sessionToken()) throw new Error("Connect to your tenant before loading inventory.");
      if (detailIndex !== undefined) {
        const row = inventory[key].rows[detailIndex];
        const identifier = view.sectionId === "power-pages" ? row.id : row.name;
        if (typeof identifier !== "string" || !identifier || /[/\\?#{}%]/.test(identifier) || [".", ".."].includes(identifier)) {
          throw new Error("The returned record has no valid detail identifier.");
        }
        const response = await requestPowerPlatformApi({
          section, apiVersion: "2024-10-01", signal: controller.signal,
          path: `environments/${encodeURIComponent(inventory[key].environmentId)}/${view.sectionId === "power-pages" ? "websites" : "apps"}/${encodeURIComponent(identifier)}`
        });
        controller.signal.throwIfAborted();
        showDetail("Application detail", response.data);
        recordRequest(section, response);
      } else {
        const page = await loadInventory({
          ...sessionOptions({ signal: controller.signal }),
          sectionId: section.id,
          environmentId: next ? inventory[key].environmentId : inventory.environmentId,
          nextLink: next ? inventory[key].nextLink : undefined
        });
        controller.signal.throwIfAborted();
        inventory[key] = { ...page, rows: next ? [...inventory[key].rows, ...page.rows] : page.rows };
        showToast(`Loaded ${inventory[key].rows.length} ${key} for ${page.environmentId}.`);
      }
    } catch (error) {
      const message = error.name === "AbortError" ? "Inventory request cancelled." : getApiErrorDescription(error);
      showToast(message);
      inventory.error = message;
    } finally {
      if (state.activeController === controller) state.activeController = undefined;
      render();
    }
  }
  overview.querySelector("#inventory-form").addEventListener("submit", (event) => {
    event.preventDefault();
    inventory.error = undefined;
    void runInventory();
  });
  overview.querySelector("#inventory-next")?.addEventListener("click", () => void runInventory(true));
  overview.querySelector("#inventory-cancel").addEventListener("click", () => state.activeController?.abort());
  overview.querySelectorAll("[data-inventory-detail]").forEach((button) =>
    button.addEventListener("click", () => showDetail("Application metadata", inventory[key].rows[Number(button.dataset.inventoryDetail)])));
  overview.querySelectorAll("[data-inventory-fetch]").forEach((button) =>
    button.addEventListener("click", () => void runInventory(false, Number(button.dataset.inventoryFetch))));
  const status = overview.querySelector("#inventory-status");
  status.textContent = inventory.error || (state.activeController ? "Loading inventory…" : "");
  if (inventory.error) status.setAttribute("role", "alert");
}

function showDetail(title, value) {
  document.querySelector("#detail-title").textContent = title;
  document.querySelector("#detail-content").textContent = JSON.stringify(value, null, 2);
  detailDialog.showModal();
}

function renderSummary(id) {
  const entry = state.summaries.get(id);
  const isApps = id === APPLICATION_MODULE.id;
  const isCopilot = id === "copilot-studio";
  const container = isApps ? content.querySelector("#application-summary") : content.querySelector("#module-summary");
  if (!container) return;
  if (!entry) {
    container.innerHTML = (isCopilot && !agentRouteKey() ? copilotTiles() : isApps ? '<div class="stats-grid">' +
      ["Total apps", "Canvas apps", "Model driven apps", "Code apps", "Power Pages"]
        .map((label) => statCard(label, "—", "Connect to load")).join("") + "</div>" : "") +
      '<p class="notice">Connect to the tenant to load summary data automatically.</p>';
    return;
  }
  const data = entry.data;
  const partial = entry.status === "loading" || Boolean(data?.errors?.length) || Boolean(entry.error);
  let markup = "";
  if (isApps) {
    const appAvailable = data && (data.appSuccess > 0 || data.environments === 0);
    const siteAvailable = data && (data.siteSuccess > 0 || data.environments === 0);
    const typed = appAvailable && data.unknown === 0;
    const note = partial ? "Partial · loading or unavailable environments" : "Accessible environments · all returned pages";
    markup = `<div class="stats-grid">
      ${statCard("Total apps", data && (appAvailable || siteAvailable) ? data.total : "—", `Power Apps + Power Pages · ${note}`)}
      ${statCard("Canvas apps", typed ? data.canvas : "—", typed ? note : "App type unavailable for some records")}
      ${statCard("Model driven apps", typed ? data.model : "—", typed ? note : "App type unavailable for some records")}
      ${statCard("Code apps", typed ? data.code : "—", typed ? note : "App type unavailable for some records")}
      ${statCard("Power Pages", siteAvailable ? data.pages : "—", note)}
      </div>
      <p class="form-hint">${data ? `${data.completed}/${data.environments} accessible environments scanned. ${data.unknown} app records have unrecognized or missing type metadata.` : "Discovering accessible environments…"}</p>`;
    for (const error of data?.errors || []) markup += `<div class="request-error" role="alert">${escapeHtml(error)}</div>`;
  } else if (isCopilot && agentRouteKey()) {
    markup = '<p class="form-hint">Agent metadata is loaded from the current session inventory. Refresh inventory to update this snapshot.</p>';
  } else if (isCopilot) {
    const note = partial ? "Partial inventory · loading, cancelled, or failed" : "Accessible tenant inventory · all returned pages";
    markup = `${copilotTiles(data)}
      <p class="form-hint">${note}. Unknown harnesses are not counted as Standard.
      Read-only Resource Query · ResourceQuery.Resources.Read and service-side inventory access required.
      Inventory changes typically appear within 20 minutes; V1 agents are not tracked.
      Harness uses properties.harness where available, otherwise Microsoft's documented isCLIAgent / model / createdIn derivation.
      ${data ? `${data.pages} page(s) loaded.` : "Loading agent inventory…"}</p>`;
    if (data) {
      const search = entry.search || "";
      const filtered = data.rows.map((row, index) => ({ ...row, index })).filter((row) =>
        JSON.stringify(row).toLowerCase().includes(search.toLowerCase()));
      const harnessNames = { github: "GitHub Copilot", standard: "Standard", chat: "Copilot Chat", unknown: "Unknown" };
      markup += `<section class="panel"><h3>Agent inventory</h3>
        <div class="field"><label for="agent-search">Search loaded agents</label><input id="agent-search" type="search" value="${escapeHtml(search)}"></div>
        <p class="form-hint">${filtered.length} matches · Showing up to 100. Details contain inventory metadata, not a fresh agent lookup.</p>
        <div class="table-wrap"><table><thead><tr><th>Agent</th><th>Environment</th><th>Harness</th><th>Classification source</th><th>Actions</th></tr></thead>
        <tbody>${filtered.slice(0, 100).map((row) => `<tr>
          <td>${escapeHtml(row.properties.displayName || row.agent.name || row.agent.id)}</td>
          <td>${escapeHtml(row.agent.environmentName || row.agent.environmentId || row.properties.environmentId || "Not supplied")}</td>
          <td>${harnessNames[row.kind]}</td><td>${escapeHtml(row.source)}</td>
          <td><button class="button button-quiet" data-agent-detail="${row.index}">Details</button></td></tr>`).join("")}</tbody></table></div>
        ${filtered.length ? "" : '<p class="form-hint">No matching agents.</p>'}</section>`;
    }
  } else if (data?.unsupported) {
    markup = '<p class="notice">This module has no configured passive tenant-wide summary operation. Select an environment/resource and use its documented operations; no identifiers or totals are guessed.</p>';
  } else {
    markup = '<div class="stats-grid">' + (data?.resources || []).map((resource, index) =>
      `${statCard(resource.title, resource.error ? "Unavailable" : resource.count ?? "Loaded", resource.error || "All returned pages · current session")}
      <button class="button button-quiet" data-summary-detail="${index}" ${resource.error ? "disabled" : ""}>View ${escapeHtml(resource.title)} details</button>`).join("") + "</div>";
  }
  if (entry.error) markup += `<div class="request-error" role="alert">${escapeHtml(entry.error)}</div>`;
  markup += `<p class="form-hint" role="status">${entry.status === "loading" ? "Loading module summary…" : entry.error ? "Summary incomplete; refresh to retry." : "Summary requests finished; any unavailable data is shown above. Refresh for current data."}</p>
    <button id="refresh-module-summary" class="button button-quiet" ${entry.status === "loading" ? "disabled" : ""}>Refresh summary</button>
    ${entry.status === "loading" ? '<button id="cancel-module-summary" class="button button-danger">Cancel summary</button>' : ""}`;
  container.innerHTML = markup;
  container.querySelector("#agent-search")?.addEventListener("input", (event) => {
    const position = event.target.selectionStart;
    entry.search = event.target.value;
    renderSummary(id);
    const input = container.querySelector("#agent-search");
    input.focus();
    input.setSelectionRange(position, position);
  });
  container.querySelectorAll("[data-agent-detail]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.lastResult?.sectionId === "copilot-studio") state.lastResult = undefined;
      if (state.lastError?.sectionId === "copilot-studio") state.lastError = undefined;
      window.location.hash = `section/copilot-studio/agent/${encodeURIComponent(agentKey(data.rows[Number(button.dataset.agentDetail)]))}`;
    });
  });
  container.querySelector("#cancel-module-summary")?.addEventListener("click", () => entry.controller.abort());
  container.querySelector("#refresh-module-summary").addEventListener("click", () => {
    state.summaries.delete(id);
    ensureModuleSummary(id);
  });
  container.querySelectorAll("[data-summary-detail]").forEach((button) => {
    button.addEventListener("click", () => {
      const resource = data.resources[Number(button.dataset.summaryDetail)];
      showDetail(resource.title, resource.data);
    });
  });
}

function ensureModuleSummary(id) {
  if (id === "app-management") return;
  let container = id === APPLICATION_MODULE.id ? content.querySelector("#application-summary") : content.querySelector("#module-summary");
  if (!container) {
    container = document.createElement("section");
    container.id = "module-summary";
    container.className = "panel";
    if (agentRouteKey()) content.querySelector("#agent-details")?.append(container);
    else content.querySelector(".stats-grid")?.after(container);
  }
  if (!sessionToken()) { renderSummary(id); return; }
  if (state.summaries.has(id)) { renderSummary(id); return; }
  const entries = state.summaries;
  const entry = { status: "loading", controller: new AbortController() };
  const finishLoading = beginLoading("Loading module summary…", id);
  entries.set(id, entry);
  const options = sessionOptions({ signal: entry.controller.signal });
  const update = () => {
    if (state.summaries === entries && state.currentSectionId === id) {
      if (id === "copilot-studio" && agentRouteKey()) render();
      else renderSummary(id);
    }
  };
  renderSummary(id);
  const work = id === APPLICATION_MODULE.id
    ? loadApplicationSummary(options, (data) => { entry.data = data; update(); })
    : id === "copilot-studio" ? loadCopilotSummary(options, (data) => { entry.data = data; update(); })
    : loadModuleSummary(id, options);
  void work.then((data) => { entry.data = data; }, (error) => {
    entry.error = error.name === "AbortError" ? "Summary cancelled. Refresh to retry." : getApiErrorDescription(error);
  }).finally(() => { entry.status = "done"; finishLoading(); update(); });
}

function render() {
  if (agentDownloadUrl) { URL.revokeObjectURL(agentDownloadUrl); agentDownloadUrl = undefined; }
  disposeAppManagement?.();
  disposeAppManagement = undefined;
  disposeConsumption?.();
  disposeConsumption = undefined;
  setConnectionStatus();
  if (["power-apps", "power-pages"].includes(state.currentSectionId)) {
    state.inventory.view = state.currentSectionId;
    state.currentSectionId = APPLICATION_MODULE.id;
  }
  updateNavigation();
  const section = state.currentSectionId === APPLICATION_MODULE.id ? APPLICATION_MODULE : getSectionById(state.currentSectionId);
  document.querySelector("#crumb").textContent = section?.title ?? "Overview";
  if (section === APPLICATION_MODULE) {
    renderApplicationModule();
  } else if (section) {
    renderSection(section);
  } else {
    state.currentSectionId = undefined;
    renderDashboard();
  }
  document.title = section
    ? `${section.title} · The Bridge`
    : "The Bridge";
  if (section) ensureModuleSummary(section.id);
  if (state.mode === "mock") {
    const notice = document.createElement("p");
    notice.className = "notice warning";
    notice.textContent = "LOCAL MOCK DATA — Sample records only. No tenant API requests are sent. Management actions are read-only.";
    content.prepend(notice);
  }
  updateLoadingIndicator();
}

function recordRequest(section, response, error) {
  const item = {
    sectionId: section.id,
    status: response?.status ?? error?.status ?? "Error",
    ok: !error,
    summary: error ? error.message : "Completed"
  };
  state.requestLog.push(item);
  if (state.requestLog.length > 60) {
    state.requestLog.shift();
  }
}

async function loadNextSectionPage(section) {
  const nextLink = extractNextLink(state.lastResult?.response?.data);
  if (!sessionToken() || !nextLink) {
    return;
  }
  const controller = new AbortController();
  state.activeController = controller;
  try {
    const response = await requestNextPage({
      section,
      nextLink,
      accessToken: state.token,
      signal: controller.signal
    });
    const previousData = state.lastResult.response.data;
    const combinedData = Array.isArray(previousData)
      ? [...previousData, ...extractRows(response.data)]
      : { ...previousData, ...response.data, value: [
          ...extractRows(previousData),
          ...extractRows(response.data)
        ] };
    state.lastResult = {
      sectionId: section.id,
      response: { ...response, data: combinedData }
    };
    state.lastError = undefined;
    recordRequest(section, response);
    showToast(`Loaded ${extractRows(combinedData).length} row(s) so far.`);
  } catch (error) {
    state.lastError = { sectionId: section.id, message: getApiErrorDescription(error) };
    recordRequest(section, undefined, error);
    showToast(getApiErrorDescription(error));
  } finally {
    state.activeController = undefined;
    render();
  }
}

async function runSectionRequest(event, section) {
  event.preventDefault();
  if (state.activeController) {
    showToast("Cancel the active request before starting another operation.");
    return;
  }
  const form = event.currentTarget;
  const formData = new FormData(form);
  const method = String(formData.get("method")).toUpperCase();
  const path = String(formData.get("path") ?? "").trim();
  const apiVersion = String(formData.get("apiVersion") ?? "").trim();
  const bodyText = String(formData.get("body") ?? "").trim();
  const status = form.querySelector("#request-status");
  const runButton = form.querySelector("#run-request");
  const cancelButton = form.querySelector("#cancel-request");

  if (!sessionToken()) {
    showToast("Connect with a delegated Power Platform API token first.");
    return;
  }

  let body;
  if (bodyText && !["POST", "PUT", "PATCH"].includes(method)) {
    status.textContent = `A JSON body is not supported for ${method}; clear the body or select POST, PUT, or PATCH.`;
    status.classList.add("inline-error");
    return;
  }
  if (bodyText && ["POST", "PUT", "PATCH"].includes(method)) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      status.textContent = "The request body must be valid JSON.";
      status.classList.add("inline-error");
      return;
    }
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const confirmed = window.confirm(
      `${method} ${section.namespace.toLowerCase()}/${path}\n\nThis request can change tenant resources. Continue only if this exact operation is documented and intended.`
    );
    if (!confirmed) {
      status.textContent = "Write request cancelled.";
      return;
    }
  }

  const controller = new AbortController();
  state.activeController = controller;
  runButton.disabled = true;
  cancelButton.classList.remove("hidden");
  status.textContent = "Sending request to Power Platform…";
  status.classList.remove("inline-error");

  try {
    let response = await requestPowerPlatformApi({
      section,
      path,
      apiVersion,
      method,
      body,
      accessToken: state.token,
      signal: controller.signal
    });
    state.lastError = undefined;
    if (response.status === 202) {
      response = await pollAcceptedOperation({
        section,
        response,
        accessToken: state.token,
        signal: controller.signal,
        onWait: ({ poll, delay }) => {
          status.textContent = `Waiting ${Math.ceil(delay / 1000)}s before operation check ${poll}…`;
        }
      });
    }
    state.lastResult = { sectionId: section.id, response };
    recordRequest(section, response);
    showToast(`API request completed with HTTP ${response.status}.`);
  } catch (error) {
    state.lastError = { sectionId: section.id, message: getApiErrorDescription(error) };
    recordRequest(section, undefined, error);
    if (error?.name === "AbortError") {
      status.textContent = "Request cancelled.";
    } else {
      status.textContent = getApiErrorDescription(error);
      status.classList.add("inline-error");
      const panel = document.querySelector("#result-panel");
      if (panel) {
        panel.innerHTML = `<div class="request-error">${escapeHtml(state.lastError.message)}</div>`;
      }
    }
  } finally {
    state.activeController = undefined;
    runButton.disabled = false;
    cancelButton.classList.add("hidden");
    render();
  }
}

function setConnectError(message) {
  const error = document.querySelector("#connect-error");
  error.textContent = message;
  error.classList.remove("hidden");
}

async function connect() {
  const tenantId = document.querySelector("#tenant-id").value.trim();
  const clientId = document.querySelector("#client-id").value.trim();
  try {
    connectionIds(tenantId, clientId);
    if (document.querySelector("#remember-connection").checked) {
      saveLocalConnection(window.localStorage, { tenantId, clientId });
    } else {
      forgetLocalConnection(window.localStorage);
    }
  } catch (error) {
    setConnectError(`Cannot prepare connection: ${error.message}`);
    return;
  }
  config.tenantId = tenantId;
  config.clientId = clientId;
  document.querySelector("#connect-error").classList.add("hidden");
  connectDialog.close();
  try {
    await beginAuthorization({
      tenantId,
      clientId,
      redirectUri: `${window.location.origin}/`,
      scope: config.scope
    });
  } catch (error) {
    connectDialog.showModal();
    setConnectError(error.message);
  }
}

async function finishAuthentication() {
  try {
    const auth = await completeAuthorization();
    if (auth) {
      state.token = auth.accessToken;
      state.tokenExpiresAt = auth.expiresAt;
      setConnectionStatus();
      showToast("Connected. The access token is held in memory for this page session.");
      render();
    }
  } catch (error) {
    clearAuthorizationFlow();
    showToast(`Sign-in failed: ${error.message}`);
  }
}

function disconnect() {
  document.querySelector("#agent-operation-dialog")?.close();
  loadingActivities.clear();
  updateLoadingIndicator();
  for (const entry of state.summaries.values()) entry.controller.abort();
  state.summaries = new Map();
  state.activeController?.abort();
  state.inventory = createInventoryState();
  disposeAppManagement?.();
  disposeAppManagement = undefined;
  state.appManagement = createAppManagementState();
  state.token = undefined;
  state.tokenExpiresAt = undefined;
  state.lastResult = undefined;
  state.lastError = undefined;
  state.requestLog = [];
  clearAuthorizationFlow();
  setConnectionStatus();
  render();
  showToast("Disconnected. In-memory tenant data and access token were cleared.");
}

document.querySelector("#connect-button").addEventListener("click", () => {
  document.querySelector("#connect-error").classList.add("hidden");
  document.querySelector("#remember-connection").checked = false;
  try {
    const saved = readLocalConnection(window.localStorage);
    if (saved) {
      Object.assign(config, saved);
      document.querySelector("#remember-connection").checked = true;
    }
  } catch (error) {
    setConnectError(`Cannot read saved connection: ${error.message}. Use Forget saved IDs to clear invalid settings.`);
  }
  document.querySelector("#tenant-id").value = config.tenantId;
  document.querySelector("#client-id").value = config.clientId;
  connectDialog.showModal();
});
document.querySelector("#save-connection").addEventListener("click", () => {
  try {
    const ids = connectionIds(document.querySelector("#tenant-id").value.trim(), document.querySelector("#client-id").value.trim());
    saveLocalConnection(window.localStorage, ids);
    Object.assign(config, ids);
    document.querySelector("#remember-connection").checked = true;
    document.querySelector("#connect-error").classList.add("hidden");
    showToast("Tenant and app IDs saved in this browser only. No repository files were written.");
  } catch (error) {
    setConnectError(`Cannot save connection: ${error.message}`);
  }
});
document.querySelector("#forget-connection").addEventListener("click", () => {
  try {
    forgetLocalConnection(window.localStorage);
    document.querySelector("#remember-connection").checked = false;
    document.querySelector("#connect-error").classList.add("hidden");
    showToast("Saved browser IDs removed. The current form is unchanged.");
  } catch (error) {
    setConnectError(`Cannot remove saved connection: ${error.message}`);
  }
});
document.querySelector("#disconnect-button").addEventListener("click", disconnect);
document.querySelector("#session-mode").addEventListener("change", (event) => {
  if (state.activeController) {
    event.target.value = state.mode;
    showToast("Cancel the active request before changing data source.");
    return;
  }
  const mode = event.target.value;
  if (!["mock", "live"].includes(mode)) return;
  state.mode = mode;
  disconnect();
  showToast(mode === "mock" ? "Local mock data enabled. No tenant calls will be sent." : "Live tenant selected. Connect to sign in.");
});
setInterval(() => {
  if (state.token && !connectionPresentation(state.mode, state.token, state.tokenExpiresAt).connected) {
    state.activeController?.abort();
    disconnect();
    showToast("Your tenant session expired. Connect again.");
  }
}, 1000);
document.querySelector("#sign-in-button").addEventListener("click", connect);
window.addEventListener("hashchange", () => {
  document.querySelector("#agent-operation-dialog")?.close();
  const [route, id] = window.location.hash.slice(1).split("/");
  state.currentSectionId = route === "section" ? id : undefined;
  render();
});
window.addEventListener("beforeunload", () => {
  disposeAppManagement?.();
  disposeConsumption?.();
  state.token = undefined;
});

const initialRoute = window.location.hash.slice(1).split("/");
state.currentSectionId = initialRoute[0] === "section" ? initialRoute[1] : undefined;
setConnectionStatus();
render();
void finishAuthentication();
