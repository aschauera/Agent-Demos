import test from "node:test";
import assert from "node:assert/strict";
import {
  SAVED_QUERIES_KEY, deleteResourceQuery, executeResourceQuery, parseResourceQuery,
  queryFolder, readSavedQueries, resourceQueryPage, resourceQueryTree, saveResourceQuery
} from "../resource-query.js";
import { RESOURCE_QUERY_SAMPLES } from "../resource-query-samples.js";
import { createQueryWorkspaceState } from "../query-workspace.js";
import { createMockFetch } from "../session-mode.js";

const text = JSON.stringify({ TableName: "PowerPlatformResources", Clauses: [], Options: { Top: 1000 } }, null, 2);
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" }
});
const storage = () => {
  const items = new Map();
  return { items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: (key) => items.delete(key) };
};
const saveOptions = { createId: () => "query-1", now: () => "2026-11-05T12:00:00Z" };

test("validates JSON query shape, nested joins, and pagination without accepting arbitrary tables", () => {
  assert.equal(parseResourceQuery(text).TableName, "PowerPlatformResources");
  for (const value of ["", "PowerPlatformResources | count", "[]", "null", "{",
    JSON.stringify({ TableName: "Other", Clauses: [] }),
    JSON.stringify({ TableName: "PowerPlatformResources", Clauses: [{ $type: "delete" }] }),
    JSON.stringify({ TableName: "PowerPlatformResources", Clauses: [{ $type: "join", RightTable: { TableName: "Other", Clauses: [] } }] })]) {
    assert.throws(() => parseResourceQuery(value));
  }
  for (const options of [null, [], { Top: 0 }, { Top: 1001 }, { Top: 1.5 }, { Skip: -1 }, { SkipToken: 5 }]) {
    assert.throws(() => parseResourceQuery(JSON.stringify({ TableName: "PowerPlatformResources", Clauses: [], Options: options })));
  }
});

test("Microsoft Learn examples and every documented resource-type template run in mock mode", async () => {
  const mock = createMockFetch();
  assert.equal(RESOURCE_QUERY_SAMPLES.length, 18);
  assert.equal(new Set(RESOURCE_QUERY_SAMPLES.map((sample) => sample.id)).size, RESOURCE_QUERY_SAMPLES.length);
  for (const sample of RESOURCE_QUERY_SAMPLES) {
    assert.equal(new URL(sample.source).hostname, "learn.microsoft.com");
    const query = parseResourceQuery(JSON.stringify(sample.query));
    const result = resourceQueryPage(await executeResourceQuery(query, { accessToken: "mock", fetchImpl: mock }));
    assert.ok(Array.isArray(result.rows), sample.name);
  }
  const joined = resourceQueryPage(await executeResourceQuery(RESOURCE_QUERY_SAMPLES[0].query, { accessToken: "mock", fetchImpl: mock }));
  assert.equal(joined.rows.length, 26);
  assert.ok(joined.rows.every((row) => ["Sample Production", "Sample Sandbox"].includes(row.environmentName)));
  const canvas = RESOURCE_QUERY_SAMPLES.find((sample) => sample.id === "simple-canvas-apps");
  assert.equal(resourceQueryPage(await executeResourceQuery(canvas.query, { accessToken: "mock", fetchImpl: mock })).rows.length, 6);
});

test("incomplete clause definitions fail clearly before being executed or saved", () => {
  for (const clause of [
    { $type: "where" }, { $type: "project", FieldList: [] }, { $type: "distinct", FieldList: [2] },
    { $type: "take", TakeCount: -1 }, { $type: "orderby", FieldNamesAscDesc: {} },
    { $type: "extend", Expression: "name" },
    { $type: "summarize", SummarizeClauseExpression: { OperatorName: "count", FieldList: [] } },
    { $type: "join", RightTable: { TableName: "PowerPlatformResources", Clauses: [] } }
  ]) {
    assert.throws(() => parseResourceQuery(JSON.stringify({ TableName: "PowerPlatformResources", Clauses: [clause] })));
  }
});

test("a global count over an empty sample set returns a genuine zero aggregate", async () => {
  const result = resourceQueryPage(await executeResourceQuery({
    TableName: "PowerPlatformResources", Clauses: [
      { $type: "where", FieldName: "type", Operator: "==", Values: ["'microsoft.powerplatform/environmentgroups'"] },
      { $type: "summarize", SummarizeClauseExpression: { OperatorName: "count", OperatorFieldName: "resources", FieldList: [] } }
    ]
  }, { accessToken: "mock", fetchImpl: createMockFetch() }));
  assert.deepEqual(result.rows, [{ resources: 0 }]);
});

test("execution uses the documented read-only operation and the user's exact body", async () => {
  const query = parseResourceQuery(text);
  const response = await executeResourceQuery(query, {
    accessToken: "delegated-token",
    fetchImpl: async (url, init) => {
      assert.equal(new URL(url).pathname, "/resourcequery/resources/query");
      assert.equal(init.method, "POST");
      assert.equal(init.headers.get("Authorization"), "Bearer delegated-token");
      assert.deepEqual(JSON.parse(init.body), query);
      return json({ data: [{ Count: 31 }], count: 1, totalRecords: 1, resultTruncated: 1 });
    }
  });
  assert.equal(resourceQueryPage(response).rows[0].Count, 31);
  await assert.rejects(executeResourceQuery(query, { fetchImpl: async () => assert.fail("No token must not send requests") }), /delegated/);
});

test("query pagination preserves columns and reports incomplete or malformed responses", async () => {
  const mock = createMockFetch();
  const query = { TableName: "PowerPlatformResources", Clauses: [], Options: { Top: 2 } };
  const first = resourceQueryPage(await executeResourceQuery(query, { accessToken: "mock", fetchImpl: mock }));
  assert.equal(first.rows.length, 2);
  assert.equal(first.totalRecords, 31);
  assert.ok(first.nextToken);
  assert.equal(first.incomplete, false);
  const next = resourceQueryPage(await executeResourceQuery({
    ...query, Options: { ...query.Options, SkipToken: first.nextToken }
  }, { accessToken: "mock", fetchImpl: mock }));
  assert.notEqual(next.rows[0].id, first.rows[0].id);
  assert.equal(resourceQueryPage({ status: 200, data: { data: [], resultTruncated: 0 } }).incomplete, true);
  for (const data of [null, [], {}, { data: {} }, { data: [], count: 1 },
    { data: [{}], totalRecords: 0 }, { data: [], skipToken: 7 }]) {
    assert.throws(() => resourceQueryPage({ status: 200, data }));
  }
});

test("saving is explicit and persists only named query text, not tokens or results", () => {
  const local = storage();
  assert.deepEqual(readSavedQueries(local), []);
  const record = saveResourceQuery(local, {
    name: " Apps ", folder: " Tenant / Apps ", text,
    accessToken: "not-persisted", result: { data: ["not-persisted"] }
  }, saveOptions);
  assert.deepEqual(Object.keys(record), ["id", "name", "folder", "text", "updatedAt"]);
  assert.equal(record.name, "Apps");
  assert.equal(record.folder, "Tenant/Apps");
  assert.deepEqual(readSavedQueries(local), [record]);
  assert.doesNotMatch(local.getItem(SAVED_QUERIES_KEY), /not-persisted|accessToken|"result"/);
  saveResourceQuery(local, { ...record, name: "Updated apps" }, saveOptions);
  assert.equal(readSavedQueries(local).length, 1);
  assert.equal(readSavedQueries(local)[0].name, "Updated apps");
  deleteResourceQuery(local, record.id);
  assert.deepEqual(readSavedQueries(local), []);
});

test("duplicate names and stale IDs do not overwrite queries from another tab", () => {
  const local = storage();
  const record = saveResourceQuery(local, { name: "Apps", folder: "Tenant", text }, saveOptions);
  assert.throws(() => saveResourceQuery(local, { name: "Apps", folder: "Tenant", text }, { ...saveOptions, createId: () => "query-2" }), /already exists/);
  assert.throws(() => saveResourceQuery(local, { name: "Other", text }, saveOptions), /generated ID/);
  deleteResourceQuery(local, record.id);
  assert.throws(() => saveResourceQuery(local, record), /removed/);
  assert.throws(() => deleteResourceQuery(local, record.id), /no longer exists/);
});

test("bad query names, folder paths, stored JSON, and quota failures are explicit", () => {
  const local = storage();
  assert.throws(() => saveResourceQuery(local, { name: " ", text }, saveOptions), /name/);
  for (const folder of ["Tenant//Apps", "../Apps", "Tenant/./Apps", 4]) assert.throws(() => queryFolder(folder));
  for (const value of ["{", "null", "{}", "[null]"]) {
    local.setItem(SAVED_QUERIES_KEY, value);
    assert.throws(() => readSavedQueries(local));
  }
  local.removeItem(SAVED_QUERIES_KEY);
  const record = saveResourceQuery(local, { name: "Apps", text }, saveOptions);
  local.setItem(SAVED_QUERIES_KEY, JSON.stringify([record, record]));
  assert.throws(() => readSavedQueries(local), /duplicate query IDs/);
  const blocked = { getItem() { throw new Error("Storage blocked"); } };
  assert.throws(() => readSavedQueries(blocked), /Storage blocked/);
  const quota = { getItem: () => null, setItem() { throw new Error("Quota exceeded"); } };
  assert.throws(() => saveResourceQuery(quota, { name: "Apps", text }, saveOptions), /Quota exceeded/);
});

test("saved query tree preserves nested folders and keeps samples separate", () => {
  const local = storage();
  const record = saveResourceQuery(local, { name: "Apps <test>", folder: "Tenant/Inventory", text }, saveOptions);
  const tree = resourceQueryTree([record]);
  assert.equal(tree[0].label, "Microsoft Learn");
  assert.equal(tree[1].label, "Saved queries");
  assert.equal(tree[1].children[0].label, "Tenant");
  assert.equal(tree[1].children[0].children[0].label, "Inventory");
  assert.equal(tree[1].children[0].children[0].children[0].savedId, record.id);
  assert.ok(tree[0].children.every((group) => group.children.every((item) => item.sampleId && !item.savedId)));
});

test("cancellation and HTTP errors propagate without returning success-shaped results", async () => {
  const query = parseResourceQuery(text);
  const controller = new AbortController();
  await assert.rejects(executeResourceQuery(query, {
    accessToken: "mock", signal: controller.signal,
    fetchImpl: async (_url, init) => {
      assert.equal(init.signal, controller.signal);
      controller.abort();
      return json({ data: [{ Count: 1 }] });
    }
  }), { name: "AbortError" });
  await assert.rejects(executeResourceQuery(query, {
    accessToken: "mock", fetchImpl: async () => json({ error: { message: "No inventory access" } }, 403)
  }), /No inventory access/);
});

test("unsupported mock expressions return query errors rather than misleading network failures", async () => {
  await assert.rejects(executeResourceQuery({
    TableName: "PowerPlatformResources",
    Clauses: [{ $type: "extend", FieldName: "unsupported", Expression: "unknown_function(name)" }]
  }, { accessToken: "mock", fetchImpl: createMockFetch() }), (error) =>
    error.status === 400 && error.code === "UnsupportedMockQuery" && /query expression/.test(error.message));
});

test("workspace drafts start without results and do not share mutable editor state", () => {
  const first = createQueryWorkspaceState();
  const second = createQueryWorkspaceState();
  first.expanded.add("custom-folder");
  first.text = "edited";
  assert.equal(second.expanded.has("custom-folder"), false);
  assert.notEqual(first.text, second.text);
  assert.equal(second.running, false);
  assert.equal(second.result, undefined);
  assert.equal(second.dirty, false);
});
