export function connectionPresentation(mode, token, expiresAt, now = Date.now()) {
  const connected = mode === "live" && Boolean(token) && Number.isFinite(expiresAt) && expiresAt > now;
  return {
    connected,
    label: mode === "mock" ? "Mock data · Offline" : connected ? "Connected" : "Not connected",
    description: mode === "mock" ? "Local sample data; no tenant API calls." :
      connected ? "Live tenant connected." : "Live tenant selected; sign in to connect."
  };
}

const MOCK_ENVIRONMENTS = [
  { id: "mock-production", name: "mock-production", displayName: "Sample Production", geo: "unitedstates", state: "Ready", type: "Production", protectionLevel: "Standard" },
  { id: "mock-sandbox", name: "mock-sandbox", displayName: "Sample Sandbox", geo: "europe", state: "Ready", type: "Sandbox", protectionLevel: "Basic" }
];
const MOCK_OWNERS = ["0f1e2d3c-1111-4aaa-8bbb-000000000001", "0f1e2d3c-2222-4aaa-8bbb-000000000002", "0f1e2d3c-3333-4aaa-8bbb-000000000003"];
const MOCK_OWNER_NAMES = ["Sample App Maker", "Sample Flow Owner", "Sample Developer"];
// [type, count, environmentId, location, owner index]
const MOCK_INVENTORY = [
  ["microsoft.powerplatform/environments", 1, "", "unitedstates", -1],
  ["microsoft.powerplatform/environments", 1, "", "europe", -1],
  ["microsoft.powerapps/canvasapps", 6, "mock-production", "unitedstates", 0],
  ["microsoft.powerapps/modeldrivenapps", 3, "mock-production", "unitedstates", 1],
  ["microsoft.powerapps/codeapps", 2, "mock-sandbox", "europe", 2],
  ["microsoft.powerautomate/cloudflows", 9, "mock-production", "unitedstates", 1],
  ["microsoft.powerautomate/agentflows", 2, "mock-sandbox", "europe", 0],
  ["microsoft.copilotstudio/agents", 2, "mock-production", "unitedstates", 0],
  ["microsoft.copilotstudio/agents", 2, "mock-sandbox", "europe", 2],
  ["microsoft.powerplatformconnector/connectors", 3, "mock-sandbox", "europe", 1]
].flatMap(([type, count, environmentId, location, owner]) => Array.from({ length: count }, (_, index) => {
  const environment = type === "microsoft.powerplatform/environments" ? MOCK_ENVIRONMENTS.find((item) => item.geo === location) : undefined;
  const name = environment?.name || `sample-${type.split("/").at(-1)}-${environmentId}-${index + 1}`;
  return {
    id: `${type}/${name}`, name, type, location,
    properties: {
      environmentId, ownerId: MOCK_OWNERS[owner] ?? "", createdBy: MOCK_OWNERS[owner] ?? "",
      displayName: environment?.displayName || `Sample ${type.split("/").at(-1)} ${index + 1}`,
      createdAt: "2026-01-15T10:30:00Z",
      ...(environment ? { environmentType: environment.type, isManaged: environment.protectionLevel === "Standard" } : {})
    }
  };
}));

class MockQueryError extends Error {}

function mockExpression(row, expression) {
  if (typeof expression !== "string") throw new MockQueryError("No sample data is available for this query expression.");
  const call = /^(tostring|tolower|todatetime)\((.*)\)$/.exec(expression);
  if (call) {
    const value = mockExpression(row, call[2]);
    if (call[1] === "tostring") return String(value ?? "");
    if (call[1] === "tolower") return String(value ?? "").toLowerCase();
    const date = Date.parse(value);
    if (!Number.isFinite(date)) throw new MockQueryError("Sample query contains an invalid date expression.");
    return date;
  }
  if (!/^[a-zA-Z_][\w.]*$/.test(expression)) throw new MockQueryError("No sample data is available for this query expression.");
  if (Object.hasOwn(row, expression)) return row[expression];
  return expression.split(".").reduce((value, key) => value?.[key], row);
}

function mockLiteral(value) {
  if (typeof value !== "string") throw new MockQueryError("No sample data is available for this query value.");
  const date = /^datetime\((.*)\)$/.exec(value);
  if (date) {
    const result = Date.parse(date[1]);
    if (!Number.isFinite(result)) throw new MockQueryError("Sample query contains an invalid date value.");
    return result;
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new MockQueryError("Sample query contains an invalid quoted value.");
    }
  }
  return value;
}

function mockQuery(clauses, input = MOCK_INVENTORY) {
  if (!Array.isArray(clauses)) throw new MockQueryError("No sample data is available for this Resource Query.");
  let rows = input.map((row) => ({ ...row }));
  for (const clause of clauses) {
    if (!clause || typeof clause !== "object") throw new MockQueryError("No sample data is available for this query clause.");
    const summarize = clause.SummarizeClauseExpression;
    if (clause.$type === "extend" && typeof clause.FieldName === "string" && clause.FieldName.trim()) {
      rows = rows.map((row) => ({ ...row, [clause.FieldName]: mockExpression(row, clause.Expression) }));
    } else if (clause.$type === "where" && ["==", "!=", "in~", ">="].includes(clause.Operator) && Array.isArray(clause.Values)) {
      const values = clause.Values.map(mockLiteral);
      rows = rows.filter((row) => {
        const value = mockExpression(row, clause.FieldName);
        if (clause.Operator === "in~") return values.some((item) => String(item).toLowerCase() === String(value ?? "").toLowerCase());
        if (clause.Operator === ">=") return value >= values[0];
        return clause.Operator === "==" ? value === values[0] : value !== values[0];
      });
    } else if (clause.$type === "project" && Array.isArray(clause.FieldList)) {
      rows = rows.map((row) => Object.fromEntries(clause.FieldList.map((field) => {
        const alias = /^(\w+)\s*=\s*(.+)$/.exec(field);
        return [alias ? alias[1] : field, mockExpression(row, alias ? alias[2] : field)];
      })));
    } else if (clause.$type === "summarize" && summarize?.OperatorName === "count" && Array.isArray(summarize.FieldList) &&
        typeof summarize.OperatorFieldName === "string" && summarize.OperatorFieldName.trim()) {
      const counts = new Map();
      if (!summarize.FieldList.length && !rows.length) counts.set("[]", { values: [], count: 0 });
      for (const row of rows) {
        const values = summarize.FieldList.map((field) => mockExpression(row, field));
        const key = JSON.stringify(values);
        const entry = counts.get(key) || { values, count: 0 };
        entry.count++;
        counts.set(key, entry);
      }
      rows = [...counts.values()].map(({ values, count }) => ({
        ...Object.fromEntries(summarize.FieldList.map((field, index) => [field, values[index]])),
        [summarize.OperatorFieldName]: count
      }));
    } else if (clause.$type === "join" && ["leftouter", "inner"].includes(clause.JoinKind) &&
        clause.RightTable?.TableName === "PowerPlatformResources") {
      const right = mockQuery(clause.RightTable.Clauses);
      if (rows.some((row) => !Object.hasOwn(row, clause.LeftColumnName)) || right.some((row) => !Object.hasOwn(row, clause.RightColumnName))) {
        throw new MockQueryError("No sample data is available for an unknown join column.");
      }
      const columns = [...new Set(right.flatMap((row) => Object.keys(row)))];
      rows = rows.flatMap((left) => {
        const matches = right.filter((row) => row[clause.RightColumnName] === left[clause.LeftColumnName]);
        if (!matches.length && clause.JoinKind === "inner") return [];
        return (matches.length ? matches : [Object.fromEntries(columns.map((key) => [key, null]))]).map((row) => {
          const merged = { ...left };
          for (const [key, value] of Object.entries(row)) merged[Object.hasOwn(merged, key) ? `${key}1` : key] = value;
          return merged;
        });
      });
    } else if (clause.$type === "orderby") {
      const fields = Object.entries(clause.FieldNamesAscDesc || {});
      if (!fields.length || fields.some(([, direction]) => !["asc", "desc"].includes(direction))) {
        throw new MockQueryError("No sample data is available for this sort clause.");
      }
      rows.sort((a, b) => {
        for (const [field, direction] of fields) {
          const left = mockExpression(a, field);
          const right = mockExpression(b, field);
          const difference = typeof left === "number" && typeof right === "number"
            ? left - right : String(left ?? "").localeCompare(String(right ?? ""));
          if (difference) return direction === "desc" ? -difference : difference;
        }
        return 0;
      });
    } else if (clause.$type === "take" && Number.isSafeInteger(clause.TakeCount) && clause.TakeCount >= 0) {
      rows = rows.slice(0, clause.TakeCount);
    } else if (clause.$type === "count") {
      rows = [{ Count: rows.length }];
    } else if (clause.$type === "distinct" && Array.isArray(clause.FieldList)) {
      const unique = new Map();
      for (const row of rows) {
        const values = clause.FieldList.map((field) => mockExpression(row, field));
        unique.set(JSON.stringify(values), Object.fromEntries(clause.FieldList.map((field, index) => [field, values[index]])));
      }
      rows = [...unique.values()];
    } else {
      throw new MockQueryError("No sample data is available for this Resource Query.");
    }
  }
  return rows;
}

export function createMockFetch() {
  return async (input, { method = "GET", signal, body } = {}) => {
    signal?.throwIfAborted();
    const url = new URL(input);
    const json = (data, status = 200) => new Response(JSON.stringify(data), {
      status, headers: { "content-type": "application/json" }
    });
    if (url.origin === "https://graph.microsoft.com" && url.pathname === "/v1.0/directoryObjects/getByIds" && method === "POST") {
      const query = JSON.parse(body);
      if (!Array.isArray(query.ids) || query.ids.some((id) => typeof id !== "string")) {
        throw new Error("No sample data is available for this directory lookup.");
      }
      return json({ value: query.ids.filter((id) => MOCK_OWNERS.includes(id.toLowerCase())).map((id) => ({
        id, displayName: MOCK_OWNER_NAMES[MOCK_OWNERS.indexOf(id.toLowerCase())]
      })) });
    }
    if (url.origin !== "https://api.powerplatform.com") throw new Error("No sample data is available for this service.");
    if (method === "POST" && url.pathname === "/resourcequery/resources/query") {
      const query = JSON.parse(body);
      if (query.TableName !== "PowerPlatformResources") throw new Error("No sample data is available for this Resource Query.");
      if (JSON.stringify(query.Clauses) !== JSON.stringify([
        { $type: "where", FieldName: "type", Operator: "in~", Values: ["'microsoft.copilotstudio/agents'"] },
        { $type: "orderby", FieldNamesAscDesc: { id: "asc" } }
      ])) {
        try {
          const rows = mockQuery(query.Clauses);
          const token = query.Options?.SkipToken;
          if (token && !/^mock-offset:\d+$/.test(token)) throw new MockQueryError("The sample continuation token is invalid.");
          const offset = token ? Number(token.slice("mock-offset:".length)) : query.Options?.Skip ?? 0;
          const top = query.Options?.Top ?? 1000;
          if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(top) || top < 1 || top > 1000) {
            throw new MockQueryError("The sample query pagination options are invalid.");
          }
          const data = rows.slice(offset, offset + top);
          const next = offset + data.length < rows.length ? `mock-offset:${offset + data.length}` : undefined;
          return json({ data, count: data.length, totalRecords: rows.length, resultTruncated: next ? 0 : 1, ...(next ? { skipToken: next } : {}) });
        } catch (error) {
          if (!(error instanceof MockQueryError)) throw error;
          return json({ error: { code: "UnsupportedMockQuery", message: error.message } }, 400);
        }
      }
      return json({ data: [
        { id: "mock-github", name: "sample-github-agent", type: "microsoft.copilotstudio/agents",
          properties: { displayName: "Sample GitHub Copilot agent", environmentId: "mock-production", harness: "GitHub Copilot" } },
        { id: "mock-standard", name: "sample-standard-agent", type: "microsoft.copilotstudio/agents",
          properties: { displayName: "Sample Standard agent", environmentId: "mock-sandbox", isCLIAgent: false, createdIn: "Copilot Studio" } },
        { id: "mock-chat", name: "sample-chat-agent", type: "microsoft.copilotstudio/agents",
          properties: { displayName: "Sample Copilot Chat agent", environmentId: "mock-production", model: "Microsoft 365 Copilot" } },
        { id: "mock-unknown", name: "sample-unknown-agent", type: "microsoft.copilotstudio/agents",
          properties: { displayName: "Sample agent with missing harness", environmentId: "mock-sandbox" } }
      ], count: 4, totalRecords: 4, resultTruncated: 1 });
    }
    if (method !== "GET") {
      throw new Error("Mock mode is read-only. Switch to Live tenant to perform management actions.");
    }
    if (/^\/copilotstudio\/environments\/[^/]+\/bots\/[^/]+\/api\/botQuarantine$/.test(url.pathname)) {
      return json({ isBotQuarantined: false, lastUpdateTimeUtc: "2026-01-01T00:00:00Z" });
    }
    if (/^\/copilotstudio\/environments\/[^/]+\/bots\/[^/]+\/api\/connectorConsentBypass$/.test(url.pathname)) {
      return json({ adminConsentBypass: false });
    }
    if (/^\/copilotstudio\/environments\/[^/]+\/bots\/[^/]+\/api\/makerevaluation\/testsets$/.test(url.pathname)) {
      return json({ value: [{ id: "sample-test-set", name: "Sample evaluation set" }] });
    }
    if (url.pathname === "/environmentmanagement/environments") {
      return json({ value: MOCK_ENVIRONMENTS });
    }
    if (/^\/powerapps\/environments\/[^/]+\/apps(?:\/[^/]+)?$/.test(url.pathname)) {
      const rows = [
        { name: "sample-code-app", type: "CodeApp", properties: { displayName: "Sample code application" } },
        { name: "sample-model-app", type: "ModelDrivenApp", properties: { displayName: "Sample model-driven application" } },
        { name: "sample-canvas-app", type: "CanvasApp", properties: { displayName: "Sample canvas application" } }
      ];
      return json(url.pathname.split("/").length > 5
        ? rows.find((row) => row.name === url.pathname.split("/").at(-1)) || {} : { value: rows });
    }
    if (/^\/powerpages\/environments\/[^/]+\/websites(?:\/[^/]+)?$/.test(url.pathname)) {
      const row = { id: "sample-site", name: "Sample customer portal", status: "OperationComplete", siteVisibility: "private" };
      return json(url.pathname.split("/").length > 5 ? row : { value: [row] });
    }
    if (url.pathname === "/appmanagement/applicationPackages" ||
        /^\/appmanagement\/environments\/[^/]+\/applicationPackages$/.test(url.pathname)) {
      let rows = [
        { uniqueName: "sample.sales", applicationName: "Sample Sales", publisherName: "Sample Publisher", version: "1.0", state: "Installed" },
        { uniqueName: "sample.service", applicationName: "Sample Service", publisherName: "Demo Publisher", version: "2.0", state: "InstallFailed" }
      ];
      if (url.searchParams.get("appInstallState")) {
        rows = rows.filter((row) => row.state === url.searchParams.get("appInstallState"));
      }
      return json({ value: rows });
    }
    if (/^\/appmanagement\/environments\/[^/]+\/operations\/[^/]+$/.test(url.pathname)) {
      return json({ operationId: url.pathname.split("/").at(-1), status: "Succeeded", statusMessage: "Simulated status only." });
    }
    throw new Error("No sample data is available for this operation. No tenant request was sent.");
  };
}

export async function mockConsumption(_input, { signal, onState } = {}) {
  signal?.throwIfAborted();
  onState?.({ phase: "complete", message: "Sample consumption report loaded. Not tenant data." });
  const csv = "Environment,Credits,Source\nSample Production,120,Mock\nSample Sandbox,35,Mock\n";
  const stream = new Blob([csv]).stream().pipeThrough(new CompressionStream("gzip"));
  const archive = await new Response(stream).blob();
  signal?.throwIfAborted();
  return {
    archive, fileName: "sample-consumption.csv.gz",
    headers: ["Environment", "Credits", "Source"],
    rows: [["Sample Production", "120", "Mock"], ["Sample Sandbox", "35", "Mock"]]
  };
}
