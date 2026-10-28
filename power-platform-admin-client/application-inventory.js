import { getSectionById } from "./api-catalog.js";
import { requestPowerPlatformApi, requestNextPage } from "./api-client.js";

export const APP_VIEWS = [
  { id: "power-apps", title: "Power Apps", sectionId: "power-apps" },
  { id: "power-pages", title: "Power Pages", sectionId: "power-pages" },
  { id: "code-apps", title: "Code Apps", sectionId: "power-apps" },
  { id: "managed-apps", title: "Managed Apps", sectionId: "power-apps" }
];

export function appView(id) {
  return APP_VIEWS.find((view) => view.id === id) || APP_VIEWS[0];
}

export function createInventoryState() {
  return { view: "power-apps", environmentId: "", search: "", apps: undefined, websites: undefined };
}

export function inventoryPage(data) {
  if (!data || !Array.isArray(data.value)) throw new Error("The API returned no valid application inventory.");
  if (data.value.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("The API returned an invalid application record.");
  }
  const nextLink = data.nextLink ?? data["@odata.nextLink"] ?? data["@odata.nextlink"];
  if (nextLink !== undefined && typeof nextLink !== "string") throw new Error("Invalid inventory next link.");
  return { rows: data.value, nextLink: nextLink || undefined };
}

export async function loadInventory({ sectionId, environmentId, nextLink, ...options }) {
  if (typeof environmentId !== "string" || !environmentId.trim() ||
      /[/\\?#{}%]/.test(environmentId) || [".", ".."].includes(environmentId.trim())) {
    throw new Error("Enter an environment ID, not an organization ID or URL.");
  }
  const section = getSectionById(sectionId);
  if (!["power-apps", "power-pages"].includes(sectionId)) throw new Error("Unsupported application inventory.");
  const operation = section.resourceGroups.flatMap((resource) => resource.operations)
    .find((item) => item.id === (sectionId === "power-apps" ? "get-adminapps" : "get-websites"));
  if (!operation) throw new Error("The documented inventory operation is missing from the API catalog.");
  const response = nextLink ? await requestNextPage({ ...options, section, nextLink }) :
    await requestPowerPlatformApi({
      ...options, section, method: operation.method, apiVersion: operation.apiVersion,
      path: operation.path.replace("{environmentId}", encodeURIComponent(environmentId.trim()))
    });
  return { ...inventoryPage(response.data), environmentId: environmentId.trim() };
}

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export function inventoryMarkup(state, enabled, busy) {
  const view = appView(state.view);
  const data = state[view.sectionId === "power-pages" ? "websites" : "apps"];
  const filtered = (data?.rows || []).map((row, index) => ({ row, index })).filter(({ row }) =>
    JSON.stringify(row).toLowerCase().includes(state.search.toLowerCase()));
  return `<div class="hero"><div class="hero-tag">APPLICATION WORKSPACE</div><h1>App Management</h1>
    <p>Inspect apps and websites in your environments. Dynamics application packages remain under Dynamics solutions.</p></div>
    <div id="application-summary"></div>
    <div class="section-heading"><h2>Application categories</h2></div>
    <div class="request-actions" role="group" aria-label="Application category">${APP_VIEWS.map((item) =>
      `<button type="button" class="button ${item.id === view.id ? "button-primary" : "button-quiet"}" data-app-view="${item.id}" aria-pressed="${item.id === view.id}">${item.title}</button>`).join("")}</div>
    ${["code-apps", "managed-apps"].includes(view.id) ? `<p class="notice warning">${view.id === "code-apps" ? "Code Apps" : "Managed Apps (interpreted as model-driven apps)"}: the current Power Platform API reference provides shared Get AdminApps and Get AdminApp operations, not a dedicated resource or type discriminator. This inventory shows all apps returned by that API; it does not claim complete coverage of this app type. Managed-solution status is not inferred. No additional create, deploy, publish, or delete endpoints are documented here.</p>` : ""}
    <section class="panel">
      <h3>${escape(view.title)} inventory</h3>
      <form id="inventory-form" class="request-form">
        <div class="field wide"><label for="inventory-environment">Environment ID (not organization ID)</label><input id="inventory-environment" required value="${escape(state.environmentId)}"></div>
        <div class="submit-row"><button class="button button-primary" ${!enabled || busy ? "disabled" : ""}>Load ${view.sectionId === "power-pages" ? "websites" : "apps"}</button><button id="inventory-cancel" class="button button-danger" type="button" ${busy ? "" : "disabled"}>Cancel inventory request</button></div>
      </form>
      <p class="form-hint">This detailed inventory covers the selected environment; the summary above scans all accessible environments separately.</p>
      <p id="inventory-status" class="form-hint" role="status"></p>
      <div class="field"><label for="inventory-search">Search loaded inventory</label><input id="inventory-search" type="search" value="${escape(state.search)}"></div>
      ${data ? `<p class="form-hint">Environment: ${escape(data.environmentId)} · ${data.rows.length} loaded${data.nextLink ? " · More pages available" : " · All pages loaded"} · Showing up to 100 matches</p>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>ID</th><th>Type / status</th><th>Actions</th></tr></thead><tbody>${filtered.slice(0, 100).map(({ row, index }) =>
        `<tr><td>${escape(row.properties?.displayName || row.name || row.id)}</td><td>${escape(view.sectionId === "power-pages" ? row.id : row.name || row.id)}</td><td>${escape(row.type || row.status || "Not specified")}</td><td><button class="button button-quiet" data-inventory-detail="${index}">Details</button><button class="button button-quiet" data-inventory-fetch="${index}" ${!enabled || busy ? "disabled" : ""}>Fetch current detail</button></td></tr>`).join("")}</tbody></table></div>
      ${!filtered.length ? '<p class="form-hint">No matching records.</p>' : ""}
      ${data.nextLink ? `<button id="inventory-next" class="button button-quiet" ${!enabled || busy ? "disabled" : ""}>Load next inventory page</button>` : ""}` : '<p class="form-hint">No inventory loaded. Connect to a tenant or select mock mode.</p>'}
    </section>
    <div class="section-heading"><h2>${escape(view.title)} operations</h2><p>All documented operations for this category's API namespace. Verify request bodies in the linked reference.</p></div>`;
}
