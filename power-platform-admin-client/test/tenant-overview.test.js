import test from "node:test";
import assert from "node:assert/strict";
import {
  COUNT_FIELD, OVERVIEW_QUERIES, countRows, environmentBreakdown, environmentNames,
  kpiTotals, loadTenantOverview, runResourceQuery
} from "../tenant-overview.js";
import { barChart, donutChart } from "../charts.js";
import { createMockFetch } from "../session-mode.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json" }
});

test("overview queries use documented server-side summarize clauses", () => {
  for (const clauses of Object.values(OVERVIEW_QUERIES)) {
    const summarize = clauses.find((clause) => clause.$type === "summarize");
    assert.equal(summarize.SummarizeClauseExpression.OperatorName, "count");
    assert.equal(summarize.SummarizeClauseExpression.OperatorFieldName, COUNT_FIELD);
    assert.equal(summarize.SummarizeClauseExpression.FieldList.length, 1);
  }
  assert.deepEqual(OVERVIEW_QUERIES.environments.at(-1), { $type: "take", TakeCount: 10 });
  assert.deepEqual(OVERVIEW_QUERIES.owners[0], { $type: "extend", FieldName: "ownerId", Expression: "tostring(properties.ownerId)" });
});

test("countRows validates counts, normalizes type keys and merges duplicates", () => {
  assert.deepEqual(countRows([
    { type: "Microsoft.PowerApps/CanvasApps", resourceCount: 2 },
    { type: "microsoft.powerapps/canvasapps", resourceCount: "3" },
    { type: "microsoft.copilotstudio/agents", resourceCount: 1 }
  ], "type"), [
    { key: "microsoft.powerapps/canvasapps", count: 5 },
    { key: "microsoft.copilotstudio/agents", count: 1 }
  ]);
  for (const bad of [null, [], { type: "a" }, { type: "a", resourceCount: -1 }, { type: "a", resourceCount: 1.5 }, { type: "a", resourceCount: "x" }, { type: "a", resourceCount: " " }]) {
    assert.throws(() => countRows([bad], "type"), /invalid/);
  }
});

test("kpiTotals buckets known types and keeps unknown types in other", () => {
  const totals = kpiTotals([
    { key: "microsoft.powerapps/canvasapps", count: 4 },
    { key: "microsoft.powerapps/codeapps", count: 1 },
    { key: "microsoft.powerautomate/cloudflows", count: 3 },
    { key: "microsoft.copilotstudio/agents", count: 2 },
    { key: "microsoft.future/thing", count: 5 }
  ]);
  assert.equal(totals.total, 15);
  assert.equal(totals.apps, 5);
  assert.equal(totals.flows, 3);
  assert.equal(totals.agents, 2);
  assert.equal(totals.environments, 0);
  assert.equal(totals.other, 5);
});

test("environment breakdown maps type and protection level and builds a name lookup", () => {
  const environments = [
    { id: "ENV-A", displayName: "Prod", type: "Production", protectionLevel: "Standard" },
    { name: "env-b", properties: { displayName: "Dev", type: "Sandbox", protectionLevel: "Basic" } },
    { id: "env-c", displayName: "Other" }
  ];
  const breakdown = environmentBreakdown(environments);
  assert.equal(breakdown.total, 3);
  assert.deepEqual(breakdown.byType.map((item) => item.key).sort(), ["Production", "Sandbox", "Unknown"]);
  assert.deepEqual(Object.fromEntries(breakdown.byProtection.map((item) => [item.key, item.count])), { Managed: 1, "Not managed": 1, Unknown: 1 });
  const names = environmentNames(environments);
  assert.equal(names.get("env-a"), "Prod");
  assert.equal(names.get("env-b"), "Dev");
});

test("runResourceQuery follows skip tokens and rejects unsafe pagination", async () => {
  const requests = [];
  const rows = await runResourceQuery(OVERVIEW_QUERIES.types, {
    accessToken: "mock",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      return body.Options.SkipToken
        ? json({ data: [{ type: "b", resourceCount: 1 }], resultTruncated: 1 })
        : json({ data: [{ type: "a", resourceCount: 2 }], skipToken: "next", resultTruncated: 0 });
    }
  });
  assert.equal(rows.length, 2);
  assert.equal(requests[0].TableName, "PowerPlatformResources");
  assert.deepEqual(requests[0].Clauses, OVERVIEW_QUERIES.types);
  assert.equal(requests[1].Options.SkipToken, "next");

  for (const data of [{ error: "x" }, { data: [], resultTruncated: 0 }, { data: [], skipToken: 7 }]) {
    await assert.rejects(runResourceQuery([], { accessToken: "mock", fetchImpl: async () => json(data) }));
  }
  await assert.rejects(runResourceQuery([], {
    accessToken: "mock", fetchImpl: async () => json({ data: [], skipToken: "same" })
  }), /repeated/);
});

test("loads the tenant overview from sample data", async () => {
  const snapshots = [];
  const result = await loadTenantOverview({ accessToken: "mock", fetchImpl: createMockFetch() }, (snapshot) => snapshots.push(snapshot));
  for (const [id, entry] of Object.entries(result)) assert.equal(entry.status, "done", `${id}: ${entry.error}`);
  const { kpis } = result.types.data;
  assert.deepEqual(
    [kpis.total, kpis.environments, kpis.apps, kpis.flows, kpis.agents, kpis.connectors, kpis.other],
    [31, 2, 11, 11, 4, 3, 0]
  );
  assert.equal(result.environments.data[0].key, "mock-production");
  assert.ok(result.environments.data.every((item) => item.key));
  assert.equal(result.regions.data.reduce((sum, item) => sum + item.count, 0), 31);
  assert.ok(result.owners.data.length <= 10 && result.owners.data.every((item) => item.key));
  assert.equal(result.harness.data.total, 4);
  assert.ok(result.environmentList.data.total >= 1);
  assert.equal(snapshots[0].environmentList.status, "loading");
});

test("isolates individual chart failures and reuses a cached Copilot summary", async () => {
  const mock = createMockFetch();
  const result = await loadTenantOverview({
    accessToken: "mock",
    fetchImpl: async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : undefined;
      if (body?.Clauses?.some((clause) => clause.FieldName === "ownerId")) return json({ error: { message: "Denied" } }, 403);
      return mock(url, init);
    }
  }, undefined, { copilotSummary: { github: 2, standard: 1, chat: 0, unknown: 0, rows: [{}, {}, {}] } });
  assert.equal(result.owners.status, "error");
  assert.match(result.owners.error, /Denied/);
  assert.equal(result.types.status, "done");
  assert.deepEqual(result.harness.data, { github: 2, standard: 1, chat: 0, unknown: 0, total: 3 });
});

test("cancelling the overview aborts instead of reporting chart errors", async () => {
  const controller = new AbortController();
  const mock = createMockFetch();
  await assert.rejects(loadTenantOverview({
    accessToken: "mock", signal: controller.signal,
    fetchImpl: async (url, init) => { controller.abort(); return mock(url, init); }
  }), { name: "AbortError" });
});

test("charts escape content, avoid inline styles and expose accessible labels", () => {
  const bars = barChart({ label: "Top <envs>", items: [
    { label: "<b>Prod</b>", value: 10, href: "#/x?a=1&b=2", copy: "id\"1" },
    { label: "Dev", value: 5 }
  ] });
  assert.doesNotMatch(bars, /style=/);
  assert.match(bars, /aria-label="Top &lt;envs&gt;"/);
  assert.match(bars, /&lt;b&gt;Prod&lt;\/b&gt;/);
  assert.match(bars, /href="#\/x\?a=1&amp;b=2"/);
  assert.match(bars, /data-copy="id&quot;1"/);
  assert.match(bars, /width="100"[^>]*height="6" rx="3"><\/rect>\s*<rect class="bar chart-c0" x="0" y="0" width="100"/);
  assert.match(bars, /class="bar chart-c1" x="0" y="0" width="50"/);
  assert.match(barChart({ label: "x", items: [] }), /chart-empty/);

  const donut = donutChart({ label: "Harness", items: [{ label: "GitHub", value: 1, color: 3 }, { label: "Standard", value: 3 }] });
  assert.doesNotMatch(donut, /style=/);
  assert.match(donut, /role="img" aria-label="Harness: GitHub 1, Standard 3"/);
  assert.match(donut, /stroke-dasharray="25 75"/);
  assert.match(donut, /chart-c3/);
  assert.match(donutChart({ label: "x", items: [{ label: "a", value: 0 }] }), /chart-empty/);
});
