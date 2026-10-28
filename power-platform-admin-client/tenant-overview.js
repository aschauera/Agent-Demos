import { ENVIRONMENTS_LIST, getSectionById } from "./api-catalog.js";
import { getApiErrorDescription, requestPowerPlatformApi } from "./api-client.js";
import { collectPages, loadCopilotSummary } from "./module-summary.js";

export const COUNT_FIELD = "resourceCount";

const countBy = (field) => ({
  $type: "summarize",
  SummarizeClauseExpression: { OperatorName: "count", OperatorFieldName: COUNT_FIELD, FieldList: [field] }
});
const byCountDesc = { $type: "orderby", FieldNamesAscDesc: { [COUNT_FIELD]: "desc" } };
const extendProperty = (field) => ({ $type: "extend", FieldName: field, Expression: `tostring(properties.${field})` });
const notEmpty = (field) => ({ $type: "where", FieldName: field, Operator: "!=", Values: ["''"] });

// Mirrors Microsoft's documented inventory sample queries (counts by type, environment, region, owner).
export const OVERVIEW_QUERIES = {
  types: [countBy("type"), byCountDesc],
  environments: [extendProperty("environmentId"), notEmpty("environmentId"), countBy("environmentId"), byCountDesc, { $type: "take", TakeCount: 10 }],
  regions: [notEmpty("location"), countBy("location"), byCountDesc],
  owners: [extendProperty("ownerId"), notEmpty("ownerId"), countBy("ownerId"), byCountDesc, { $type: "take", TakeCount: 10 }]
};

export const KPI_BUCKETS = [
  { id: "environments", label: "Environments", types: ["microsoft.powerplatform/environments"], sectionId: "environment-management" },
  { id: "apps", label: "Apps", types: ["microsoft.powerapps/canvasapps", "microsoft.powerapps/modeldrivenapps", "microsoft.powerapps/codeapps", "microsoft.powerapps/apps"], sectionId: "application-management" },
  { id: "flows", label: "Flows", types: ["microsoft.powerautomate/cloudflows", "microsoft.powerautomate/agentflows"], sectionId: "power-automate" },
  { id: "agents", label: "Agents", types: ["microsoft.copilotstudio/agents"], sectionId: "copilot-studio" },
  { id: "connectors", label: "Connectors", types: ["microsoft.powerplatformconnector/connectors"], sectionId: "connectivity" }
];

function resourceQueryOperation() {
  const section = getSectionById("resource-query");
  const operation = section?.resourceGroups.flatMap((group) => group.operations).find((item) => item.id === "query-resources");
  if (!operation) throw new Error("The documented Resource Query operation is missing from the catalog.");
  return { section, operation };
}

export async function runResourceQuery(clauses, options) {
  const { section, operation } = resourceQueryOperation();
  const rows = [];
  const seen = new Set();
  let skipToken;
  do {
    options.signal?.throwIfAborted();
    const response = await requestPowerPlatformApi({
      ...options, section, ...operation,
      body: { TableName: "PowerPlatformResources", Clauses: clauses, Options: { Top: 1000, ...(skipToken ? { SkipToken: skipToken } : {}) } }
    });
    options.signal?.throwIfAborted();
    const data = response.data;
    if (!Array.isArray(data?.data)) throw new Error("Resource Query returned no valid result rows.");
    rows.push(...data.data);
    skipToken = data.skipToken;
    if (skipToken !== undefined && skipToken !== null && typeof skipToken !== "string") {
      throw new Error("Resource Query returned an invalid continuation token; results are incomplete.");
    }
    if (skipToken) {
      if (seen.has(skipToken) || seen.size >= 999) throw new Error("Resource Query pagination repeated a token or exceeded 1000 pages; results are incomplete.");
      seen.add(skipToken);
    } else if (data.resultTruncated === 0 || data.resultTruncated === "0") {
      throw new Error("Resource Query reported truncated results without a continuation token. Refresh to retry.");
    }
  } while (skipToken);
  return rows;
}

export function countRows(rows, field) {
  const totals = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Resource Query returned an invalid aggregate row.");
    const count = typeof row[COUNT_FIELD] === "string" && row[COUNT_FIELD].trim() !== "" ? Number(row[COUNT_FIELD]) : row[COUNT_FIELD];
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Resource Query returned an invalid ${COUNT_FIELD} value.`);
    const key = typeof row[field] === "string" ? row[field].trim() : row[field] == null ? "" : String(row[field]);
    const normalized = field === "type" ? key.toLowerCase() : key;
    totals.set(normalized, (totals.get(normalized) || 0) + count);
  }
  return [...totals].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function kpiTotals(typeCounts) {
  const totals = { total: 0, other: 0 };
  for (const bucket of KPI_BUCKETS) totals[bucket.id] = 0;
  for (const { key, count } of typeCounts) {
    totals.total += count;
    const bucket = KPI_BUCKETS.find((item) => item.types.includes(key));
    if (bucket) totals[bucket.id] += count;
    else totals.other += count;
  }
  return totals;
}

const PROTECTION_LABELS = { standard: "Managed", basic: "Not managed" };

export function environmentBreakdown(environments) {
  const tally = (values) => {
    const map = new Map();
    for (const value of values) map.set(value, (map.get(value) || 0) + 1);
    return [...map].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  };
  const field = (environment, name) => environment?.[name] ?? environment?.properties?.[name];
  return {
    total: environments.length,
    byType: tally(environments.map((environment) => {
      const value = field(environment, "type");
      return typeof value === "string" && value.trim() ? value.trim() : "Unknown";
    })),
    // The Environments API documents protectionLevel; Standard protection corresponds to Managed Environments.
    byProtection: tally(environments.map((environment) => {
      const value = field(environment, "protectionLevel");
      if (typeof value !== "string" || !value.trim()) return "Unknown";
      return PROTECTION_LABELS[value.trim().toLowerCase()] || value.trim();
    }))
  };
}

export function environmentNames(environments) {
  const names = new Map();
  for (const environment of environments) {
    const name = environment?.displayName ?? environment?.properties?.displayName;
    for (const id of [environment?.id, environment?.name]) {
      if (typeof id === "string" && id && typeof name === "string" && name) names.set(id.toLowerCase(), name);
    }
  }
  return names;
}

export const OVERVIEW_CHARTS = ["environmentList", "types", "environments", "regions", "harness", "owners"];

export async function loadTenantOverview(options, onProgress = () => {}, { copilotSummary } = {}) {
  const result = Object.fromEntries(OVERVIEW_CHARTS.map((id) => [id, { status: "pending" }]));
  const publish = () => onProgress(structuredClone(result));
  const step = async (id, work) => {
    options.signal?.throwIfAborted();
    result[id] = { status: "loading" };
    publish();
    try {
      result[id] = { status: "done", data: await work() };
    } catch (error) {
      if (error.name === "AbortError") throw error;
      result[id] = { status: "error", error: getApiErrorDescription(error) };
    }
    publish();
  };
  await step("environmentList", async () => {
    const section = getSectionById("environment-management");
    const initial = await requestPowerPlatformApi({ ...options, ...ENVIRONMENTS_LIST, section });
    const rows = await collectPages(section, initial, options);
    const unique = [...new Map(rows.map((row, index) => [row?.id || row?.name || `row-${index}`, row])).values()];
    return { ...environmentBreakdown(unique), names: [...environmentNames(unique)] };
  });
  await step("types", async () => {
    const counts = countRows(await runResourceQuery(OVERVIEW_QUERIES.types, options), "type");
    return { counts, kpis: kpiTotals(counts) };
  });
  await step("environments", async () => countRows(await runResourceQuery(OVERVIEW_QUERIES.environments, options), "environmentId").slice(0, 10));
  await step("regions", async () => countRows(await runResourceQuery(OVERVIEW_QUERIES.regions, options), "location"));
  await step("harness", async () => {
    const summary = copilotSummary || await loadCopilotSummary(options);
    return { github: summary.github, standard: summary.standard, chat: summary.chat, unknown: summary.unknown, total: summary.rows.length };
  });
  await step("owners", async () => countRows(await runResourceQuery(OVERVIEW_QUERIES.owners, options), "ownerId").slice(0, 10));
  return result;
}
