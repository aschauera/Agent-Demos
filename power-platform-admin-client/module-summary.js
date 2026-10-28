import { ENVIRONMENTS_LIST, getSectionById } from "./api-catalog.js";
import { extractNextLink, getApiErrorDescription, requestNextPage, requestPowerPlatformApi } from "./api-client.js";
import { inventoryPage, loadInventory } from "./application-inventory.js";

// Only passive resource reads are eligible; trigger polling and action endpoints are excluded.
const overviewPaths = {
  analytics: ["advisorRecommendations"],
  authorization: ["roleAssignments", "roleDefinitions"],
  "environment-management": ["environments", "environmentGroups"],
  governance: ["crossTenantConnectionReports", "ruleBasedPolicies", "ruleSets"],
  licensing: ["billingPolicies", "isvContracts", "tenantCapacity"],
  "workflows-agent": ["flows", "connections", "prompts"]
};

export async function collectPages(section, response, options) {
  const rows = [...inventoryPage(response.data).rows];
  const seen = new Set();
  let nextLink = extractNextLink(response.data);
  while (nextLink) {
    options.signal?.throwIfAborted();
    if (seen.has(nextLink) || seen.size >= 1000) throw new Error("Pagination repeated a link or exceeded the 1000-page safety limit; summary is incomplete.");
    seen.add(nextLink);
    response = await requestNextPage({ ...options, section, nextLink });
    rows.push(...inventoryPage(response.data).rows);
    nextLink = extractNextLink(response.data);
  }
  return rows;
}

export function appKind(app) {
  const value = app.properties?.appType ?? app.appType ?? app.properties?.type ?? app.type;
  const normalized = typeof value === "string" ? value.toLowerCase().replace(/[\s_-]/g, "") : "";
  if (["canvas", "canvasapp", "canvasapps"].includes(normalized)) return "canvas";
  if (["modeldriven", "modeldrivenapp", "modeldrivenapps"].includes(normalized)) return "model";
  if (["code", "codeapp", "codeapps"].includes(normalized)) return "code";
  return "unknown";
}

export function agentProperties(agent) {
  const properties = typeof agent.properties === "string" ? JSON.parse(agent.properties) : agent.properties;
  if (properties === undefined || properties === null) return {};
  if (typeof properties !== "object" || Array.isArray(properties)) throw new Error("Invalid agent inventory properties.");
  return properties;
}

export function agentHarness(agent) {
  const properties = agentProperties(agent);
  if (typeof properties.harness === "string" && properties.harness.trim()) {
    const harness = properties.harness.toLowerCase().replace(/[\s_-]/g, "").replace(/harness$/, "");
    const kind = { githubcopilot: "github", standard: "standard", copilotchat: "chat" }[harness] || "unknown";
    return { kind, source: "properties.harness" };
  }
  // Microsoft's inventory sample query derives harness for older inventory records.
  if (properties.isCLIAgent === true || properties.isCLIAgent === "true") {
    return { kind: "github", source: "Derived from isCLIAgent" };
  }
  const model = typeof properties.model === "string" ? properties.model.trim().toLowerCase() : "";
  const createdIn = typeof properties.createdIn === "string" ? properties.createdIn.trim().toLowerCase() : "";
  if (model === "microsoft 365 copilot" || createdIn === "microsoft 365 copilot agent builder") {
    return { kind: "chat", source: "Derived from model / createdIn" };
  }
  if (properties.isCLIAgent === false || properties.isCLIAgent === "false" || model || createdIn) {
    return { kind: "standard", source: "Derived using Microsoft's inventory sample query" };
  }
  return { kind: "unknown", source: "Harness metadata unavailable" };
}

export async function loadCopilotSummary(options, onProgress = () => {}) {
  const section = getSectionById("resource-query");
  const operation = section.resourceGroups.flatMap((group) => group.operations)
    .find((item) => item.id === "query-resources");
  if (!operation) throw new Error("The documented Resource Query operation is missing from the catalog.");
  const rows = new Map();
  const seen = new Set();
  let skipToken;
  let snapshot;
  do {
    options.signal?.throwIfAborted();
    const response = await requestPowerPlatformApi({
      ...options, section, ...operation,
      body: {
        TableName: "PowerPlatformResources",
        Clauses: [
          { $type: "where", FieldName: "type", Operator: "in~", Values: ["'microsoft.copilotstudio/agents'"] },
          { $type: "orderby", FieldNamesAscDesc: { id: "asc" } }
        ],
        Options: { Top: 1000, ...(skipToken ? { SkipToken: skipToken } : {}) }
      }
    });
    options.signal?.throwIfAborted();
    const data = response.data;
    if (!Array.isArray(data?.data)) throw new Error("Resource Query returned no valid agent inventory.");
    for (const agent of data.data) {
      if (!agent || typeof agent !== "object" || Array.isArray(agent) ||
          typeof agent.type !== "string" || agent.type.toLowerCase() !== "microsoft.copilotstudio/agents" || !(agent.id || agent.name)) {
        throw new Error("Resource Query returned an invalid agent record.");
      }
      const properties = agentProperties(agent);
      const key = agent.id || `${agent.environmentId || properties.environmentId || ""}/${agent.name}`;
      rows.set(key, { agent, properties, ...agentHarness(agent) });
    }
    snapshot = { rows: [...rows.values()], github: 0, standard: 0, chat: 0, unknown: 0, pages: seen.size + 1 };
    for (const row of snapshot.rows) snapshot[row.kind]++;
    onProgress(snapshot);
    skipToken = data.skipToken;
    if (skipToken !== undefined && skipToken !== null && typeof skipToken !== "string") {
      throw new Error("Resource Query returned an invalid continuation token; inventory is incomplete.");
    }
    if (skipToken) {
      if (seen.has(skipToken) || seen.size >= 999) throw new Error("Agent inventory pagination repeated a token or exceeded 1000 pages; inventory is incomplete.");
      seen.add(skipToken);
    } else if (data.resultTruncated === 0 || data.resultTruncated === "0" ||
               (Number.isFinite(data.totalRecords) && data.totalRecords > rows.size)) {
      throw new Error("Resource Query reported incomplete results without a continuation token. Refresh to retry.");
    }
  } while (skipToken);
  return snapshot;
}

export async function loadApplicationSummary(options, onProgress = () => {}) {
  const envSection = getSectionById("environment-management");
  const initial = await requestPowerPlatformApi({
    ...options, ...ENVIRONMENTS_LIST, section: envSection
  });
  const rows = await collectPages(envSection, initial, options);
  const environments = [...new Map(rows.map((row, index) => [row.name || row.id || `row-${index}`, row])).values()];
  const summary = { total: 0, canvas: 0, model: 0, code: 0, pages: 0, unknown: 0,
    environments: environments.length, completed: 0, appSuccess: 0, siteSuccess: 0, errors: [] };
  for (const environment of environments) {
    options.signal?.throwIfAborted();
    const environmentId = environment.name || environment.id;
    for (const sectionId of ["power-apps", "power-pages"]) {
      try {
        const page = await loadInventory({ ...options, sectionId, environmentId });
        const section = getSectionById(sectionId);
        const rows = await collectPages(section, {
          data: { value: page.rows, nextLink: page.nextLink }
        }, options);
        const unique = new Map(rows.map((row, index) => [row.id || row.name || `row-${index}`, row]));
        if (sectionId === "power-apps") {
          summary.appSuccess++;
          summary.total += unique.size;
          for (const row of unique.values()) summary[appKind(row)]++;
        } else {
          summary.siteSuccess++;
          summary.pages += unique.size;
          summary.total += unique.size;
        }
      } catch (error) {
        if (error.name === "AbortError") throw error;
        summary.errors.push(`${environmentId || "Missing environment ID"} · ${sectionId}: ${getApiErrorDescription(error)}`);
      }
    }
    summary.completed++;
    onProgress({ ...summary, errors: [...summary.errors] });
  }
  return summary;
}

export async function loadModuleSummary(sectionId, options) {
  const paths = overviewPaths[sectionId];
  if (!paths) return { unsupported: true, resources: [] };
  const section = getSectionById(sectionId);
  const operations = section.resourceGroups.flatMap((group) => group.operations);
  const resources = [];
  for (const path of paths) {
    options.signal?.throwIfAborted();
    const operation = operations.find((item) => item.path === path && item.method === "GET");
    if (!operation) {
      resources.push({ title: path, error: "Overview operation is not present in the documented catalog." });
      continue;
    }
    try {
      const response = await requestPowerPlatformApi({
        ...options, section, path, apiVersion: operation.apiVersion
      });
      const rows = Array.isArray(response.data?.value)
        ? await collectPages(section, response, options) : undefined;
      resources.push({ title: operation.title, count: rows?.length, data: rows ? { ...response.data, value: rows } : response.data });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      resources.push({ title: operation.title, error: getApiErrorDescription(error) });
    }
  }
  return { resources };
}
