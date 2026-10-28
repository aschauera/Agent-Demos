import { createAppManagementApi, packagePage, summarizePackages, assertInstallStatus } from "./app-management-api.js";
import { getApiErrorDescription, validateNextLink } from "./api-client.js";
import { getSectionById } from "./api-catalog.js";

const section = getSectionById("app-management");
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const states = ["None", "Installed", "Uninstalled", "InstallRequested", "UninstallRequested", "InstallFailed",
  "UninstallFailed", "Installing", "Uninstalling", "InstallScheduled", "InstallRetrying", "TemplateInstalled"];

export function createAppManagementState() {
  return {
    tenant: { rows: [], loaded: false }, environment: { rows: [], loaded: false },
    environmentId: "", appInstallState: "", lcid: "", search: "", uniqueName: "", payloadValue: "",
    operationId: "", operationEnvironmentId: "", operation: undefined, install: undefined, retryUntil: 0
  };
}

export function mountAppManagement(root, {
  state, accessToken, showDetail, confirm = (message) => window.confirm(message), recordRequest = () => {},
  fetchImpl = fetch, autoLoad = false, beginLoading = () => () => {}
}) {
  let disposed = false;
  let controller;
  let busy = false;
  let finishActiveLoading;
  let message = "Load tenant packages, or enter an environment ID to inspect its packages.";
  let error;
  let cooldownTimer;
  const field = (id) => root.querySelector(`#am-${id}`);
  const card = (label, value, note) => `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value accent-cyan">${value}</div><div class="stat-note">${note}</div></div>`;
  const count = (data, value) => data.loaded ? value : "—";

  function respectRetryAfter(response) {
    const retryAfter = response.headers.get("retry-after");
    if (!retryAfter) return;
    const seconds = Number(retryAfter);
    const deadline = Number.isFinite(seconds) && seconds >= 0
      ? Date.now() + seconds * 1000 : Date.parse(retryAfter);
    if (!Number.isFinite(deadline)) throw new Error("The API returned an invalid Retry-After.");
    state.retryUntil = Math.max(Date.now(), deadline);
    scheduleRetry();
  }

  function scheduleRetry() {
    clearTimeout(cooldownTimer);
    if (state.retryUntil > Date.now()) {
      cooldownTimer = setTimeout(() => { remember(); draw(); scheduleRetry(); },
        Math.min(state.retryUntil - Date.now(), 2147483647));
    }
  }

  function remember() {
    for (const [id, key] of [["environment", "environmentId"], ["state", "appInstallState"], ["lcid", "lcid"],
      ["search", "search"], ["package", "uniqueName"], ["payload", "payloadValue"],
      ["operation", "operationId"], ["operation-environment", "operationEnvironmentId"]]) {
      if (field(id)) state[key] = field(id).value;
    }
  }

  function table(data, scope) {
    if (!data.loaded) return '<div class="empty-state">Not loaded. Connect and load package data.</div>';
    const rows = data.rows.map((row, index) => ({ row, index })).filter(({ row }) =>
      [row.applicationName, row.localizedName, row.uniqueName, row.publisherName, row.state]
        .some((value) => String(value ?? "").toLowerCase().includes(state.search.toLowerCase())));
    return `<p class="form-hint">${data.rows.length} loaded${data.nextLink ? " · Partial: more pages available" : " · All pages for this query loaded"}${scope === "environment" ? ` · Environment: ${escape(data.environmentId)} · State filter: ${escape(data.appInstallState || "All")} · LCID: ${escape(data.lcid || "Default")}` : ""}. Showing ${Math.min(rows.length, 100)} of ${rows.length} matching packages.</p>
      <div class="table-wrap"><table><thead><tr><th>Application</th><th>Publisher</th><th>Unique name</th>${scope === "environment" ? "<th>Version</th><th>State</th>" : ""}<th>Actions</th></tr></thead><tbody>
      ${rows.slice(0, 100).map(({ row, index }) => `<tr><td>${escape(row.localizedName || row.applicationName || "Unnamed")}</td><td>${escape(row.publisherName || "Unknown")}</td><td>${escape(row.uniqueName)}</td>
        ${scope === "environment" ? `<td>${escape(row.version || "Unknown")}</td><td>${escape(row.state || "Unknown")}</td>` : ""}
        <td><button class="button button-quiet button-small" data-detail="${index}" data-scope="${scope}">Details</button>
        <button class="button button-quiet button-small" data-install="${index}" data-scope="${scope}" ${!row.uniqueName || busy ? "disabled" : ""}>Prepare install</button></td></tr>`).join("")}
      </tbody></table></div>${!rows.length ? '<div class="empty-state">No packages match this query.</div>' : ""}
      ${data.nextLink ? `<button id="am-next-${scope}" class="button button-quiet" ${busy || !accessToken ? "disabled" : ""}>Load next page</button>` : ""}`;
  }

  function draw() {
    if (disposed) return;
    const tenantSummary = summarizePackages(state.tenant.rows);
    const environmentSummary = summarizePackages(state.environment.rows);
    const disabled = busy || !accessToken ? "disabled" : "";
    root.innerHTML = `
      <div class="hero"><div class="hero-tag">TENANT APPLICATION PACKAGES</div><h1>Dynamics solutions</h1>
      <p>Discover Dynamics solutions available to your tenant, inspect packages in a target environment, and manage installations.</p></div>
      <div class="stats-grid">
        ${card("Tenant packages", count(state.tenant, tenantSummary.packages), state.tenant.nextLink ? "Partial · more pages available" : "Loaded installable catalog")}
        ${card("Publishers", count(state.tenant, tenantSummary.publishers), "Distinct publishers in loaded tenant packages")}
        ${card("Installed in environment", count(state.environment, environmentSummary.installed), "Installed + TemplateInstalled in loaded query")}
        ${card("Needs attention", count(state.environment, environmentSummary.failed), state.environment.loaded ? `${environmentSummary.inProgress} installs/uninstalls in progress in loaded query` : "Load environment inventory to inspect failures")}
      </div>
      <p class="notice">These APIs manage application packages, not every canvas/model-driven app in the tenant. Environment counts cover only the selected environment, state filter, and loaded pages. Read: AppManagement.ApplicationPackages.Read. Install: AppManagement.ApplicationPackages.Install.</p>
      <div class="request-actions"><button id="am-load-tenant" class="button button-primary" ${disabled}>Load tenant packages</button>
      <button id="am-cancel" class="button button-danger" ${busy ? "" : "disabled"}>Cancel request</button></div>
      <p id="am-message" role="status" aria-live="polite" class="form-hint">${escape(message)}</p>
      ${error ? `<div class="request-error" role="alert">${escape(error)}</div>` : ""}
      <section class="panel">
        <h3>Environment packages</h3>
        <form id="am-environment-form" class="request-form">
          <div class="field"><label for="am-environment">Environment ID (not organization ID)</label><input id="am-environment" required value="${escape(state.environmentId)}"></div>
          <div class="field"><label for="am-state">Install state filter</label><select id="am-state"><option value="">All states</option>${states.map((value) => `<option ${state.appInstallState === value ? "selected" : ""}>${value}</option>`).join("")}</select></div>
          <div class="field"><label for="am-lcid">Language ID (optional)</label><input id="am-lcid" inputmode="numeric" pattern="[0-9]+" value="${escape(state.lcid)}" placeholder="1033"></div>
          <div class="submit-row"><button class="button button-primary" ${disabled}>Load environment packages</button></div>
        </form>
      </section>
      <div class="field am-search"><label for="am-search">Search loaded packages</label><input id="am-search" type="search" value="${escape(state.search)}" placeholder="Application, publisher, unique name, or state"></div>
      <section class="panel"><div class="panel-title"><h3>Tenant application catalog</h3><span>Available for install</span></div>${table(state.tenant, "tenant")}</section>
      <section class="panel"><div class="panel-title"><h3>Environment package inventory</h3><span>Selected environment</span></div>${table(state.environment, "environment")}</section>
      <section class="panel"><h3>Install application package</h3>
        <p class="notice warning">Installation changes the target environment. Verify package details, licensing, prerequisites, and package-specific payload before confirming. Cancelling a local request does not undo a submitted installation.</p>
        <form id="am-install-form" class="request-form">
          <div class="field wide"><label for="am-package">Package unique name</label><input id="am-package" required value="${escape(state.uniqueName)}"></div>
          <div class="field wide"><label for="am-payload">payloadValue (string; package-specific, optional empty value)</label><textarea id="am-payload">${escape(state.payloadValue)}</textarea></div>
          <p class="form-hint">Target: the Environment ID above. The request body is {"payloadValue":"..."}. No package-specific payload is inferred.</p>
          <div class="submit-row"><button class="button button-danger" ${disabled}>Review and install</button></div>
        </form>
        ${state.install ? `<p class="form-hint">${escape(state.install.message)}</p><button id="am-install-details" class="button button-quiet">Installation response</button>` : ""}
      </section>
      <section class="panel"><h3>Installation status</h3>
        <form id="am-status-form" class="request-form">
          <div class="field"><label for="am-operation-environment">Operation environment ID</label><input id="am-operation-environment" required value="${escape(state.operationEnvironmentId)}"></div>
          <div class="field"><label for="am-operation">Operation ID (GUID)</label><input id="am-operation" required value="${escape(state.operationId)}"></div>
          <div class="submit-row"><button class="button button-primary" ${disabled || Date.now() < state.retryUntil ? "disabled" : ""}>Check install status</button></div>
        </form>
        <p class="form-hint">Checks are explicit, not automatic. ${state.retryUntil > Date.now() ? `Server Retry-After: status check available after ${escape(new Date(state.retryUntil).toLocaleTimeString())}.` : "Observe any server-provided Retry-After before the next request."}</p>
        ${state.operation ? `<p class="form-hint">Operation ${escape(state.operation.data.operationId || state.operationId)}: ${escape(state.operation.data.status)} · ${escape(state.operation.data.statusMessage)}</p><button id="am-operation-details" class="button button-quiet">Operation details</button>` : ""}
      </section>
      <p class="form-hint"><a href="${section.docsUrl}" target="_blank" rel="noreferrer">Microsoft Learn: application package operations</a></p>`;

    field("load-tenant").addEventListener("click", () => run("Loading tenant packages", async (api) => {
      const response = await api.tenantPackages();
      state.tenant = { ...packagePage(response.data), loaded: true };
    }));
    field("environment-form").addEventListener("submit", (event) => {
      event.preventDefault();
      run("Loading environment packages", async (api) => {
        const parameters = { environmentId: state.environmentId, appInstallState: state.appInstallState, lcid: state.lcid };
        const response = await api.environmentPackages(parameters);
        state.environment = { ...packagePage(response.data), ...parameters, loaded: true };
      });
    });
    field("search").addEventListener("input", () => {
      remember();
      const position = field("search").selectionStart;
      draw();
      field("search").focus();
      field("search").setSelectionRange(position, position);
    });
    root.querySelectorAll("[data-detail]").forEach((button) => button.addEventListener("click", () => {
      const row = state[button.dataset.scope].rows[Number(button.dataset.detail)];
      showDetail(row.localizedName || row.applicationName || "Application package", row);
    }));
    root.querySelectorAll("[data-install]").forEach((button) => button.addEventListener("click", () => {
      remember();
      state.uniqueName = state[button.dataset.scope].rows[Number(button.dataset.install)].uniqueName;
      if (button.dataset.scope === "environment") state.environmentId = state.environment.environmentId;
      state.payloadValue = "";
      draw();
      field("install-form").scrollIntoView({ behavior: "smooth", block: "center" });
    }));
    for (const scope of ["tenant", "environment"]) {
      field(`next-${scope}`)?.addEventListener("click", () => run("Loading next package page", async (api) => {
        const data = state[scope];
        const page = packagePage((await api.next(data.nextLink)).data);
        state[scope] = { ...data, rows: [...data.rows, ...page.rows], nextLink: page.nextLink };
      }));
    }
    field("install-form").addEventListener("submit", (event) => {
      event.preventDefault();
      remember();
      if (!confirm(`Install package "${state.uniqueName}" in environment "${state.environmentId}"?\n\nThis changes the environment. Confirm licensing, prerequisites, and payload before continuing.`)) return;
      run("Submitting package installation", async (api) => {
        state.install = undefined;
        const response = await api.install(state);
        state.operationEnvironmentId = state.environmentId;
        state.operationId = response.data?.lastOperation?.operationId || "";
        state.operation = undefined;
        let locationError;
        const location = response.headers.get("location");
        if (location) {
          try {
            const url = validateNextLink(section, new URL(location, response.url).href);
            const match = url.pathname.match(/^\/appmanagement\/environments\/([^/]+)\/operations\/([^/]+)$/);
            if (match && decodeURIComponent(match[1]) === state.environmentId.trim()) state.operationId = decodeURIComponent(match[2]);
          } catch (error) { locationError = error; }
        }
        state.install = {
          data: response.data, status: response.status, location,
          message: `HTTP ${response.status}: ${response.status === 202 ? "Installation accepted, not completed." : "Installation response received; inspect lastOperation and check status."}${state.operationId ? " Operation ID populated below." : " No operation ID returned. Use an operation ID supplied by the service to check status."}`
        };
        respectRetryAfter(response);
        if (locationError) throw locationError;
        if (response.data?.lastOperation?.state === "InstallFailed") {
          throw new Error(response.data.lastOperation.errorDetails?.message || "Package installation failed.");
        }
      });
    });
    field("status-form").addEventListener("submit", (event) => {
      event.preventDefault();
      if (Date.now() < state.retryUntil) return;
      run("Checking installation status", async (api) => {
        const response = await api.status({ environmentId: state.operationEnvironmentId, operationId: state.operationId });
        state.operation = response;
        const retryAfter = response.headers.get("retry-after");
        respectRetryAfter(response);
        const status = assertInstallStatus(response);
        message = `Installation ${status}. ${response.data.statusMessage || ""}${retryAfter ? ` Retry-After: ${retryAfter}.` : ""}`;
      });
    });
    field("install-details")?.addEventListener("click", () => showDetail("Installation response", state.install));
    field("operation-details")?.addEventListener("click", () => showDetail("Installation status", state.operation.data));
    field("cancel").addEventListener("click", () => controller?.abort());
    root.querySelectorAll("form input, form select, form textarea").forEach((input) => { input.disabled = busy; });
  }

  async function run(label, action) {
    if (busy || disposed) return;
    remember();
    if (!accessToken) { error = "Connect to the tenant before loading application packages."; draw(); return; }
    busy = true;
    const finishLoading = beginLoading(`${label}…`);
    finishActiveLoading = finishLoading;
    error = undefined;
    message = `${label}…`;
    controller = new AbortController();
    const trackedFetch = async (...args) => {
      const response = await fetchImpl(...args);
      if (!disposed) recordRequest(section, { status: response.status }, response.ok ? undefined : { status: response.status, message: response.statusText });
      return response;
    };
    draw();
    scheduleRetry();
    try {
      await action(createAppManagementApi({ accessToken, signal: controller.signal, fetchImpl: trackedFetch }));
      if (message === `${label}…`) message = `${label} complete. Counts reflect loaded API data.`;
    } catch (failure) {
      message = failure?.name === "AbortError" ? "Request cancelled. Submitted installations may still continue on the service." : `${label} failed.`;
      if (failure?.name !== "AbortError") error = getApiErrorDescription(failure);
    } finally {
      finishLoading();
      busy = false;
      controller = undefined;
      draw();
    }
  }

  draw();
  if (autoLoad && !state.autoLoaded) {
    state.autoLoaded = true;
    void run("Loading tenant packages", async (api) => {
      state.tenant = { ...packagePage((await api.tenantPackages()).data), loaded: true };
    });
  }
  return () => {
    finishActiveLoading?.();
    remember();
    disposed = true;
    controller?.abort();
    clearTimeout(cooldownTimer);
  };
}
