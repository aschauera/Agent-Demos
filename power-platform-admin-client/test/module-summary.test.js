import test from "node:test";
import assert from "node:assert/strict";
import { appKind, loadApplicationSummary, loadModuleSummary } from "../module-summary.js";
import { NAVIGATION_MODULES } from "../api-catalog.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json" }
});

test("App Management occupies numbered position 02, with Dynamics solutions separate", () => {
  assert.equal(NAVIGATION_MODULES[1].title, "App Management");
  assert.ok(NAVIGATION_MODULES.some((module) => module.title === "Dynamics solutions"));
});

test("classifies only explicit type metadata, never names or generic provider type", () => {
  assert.equal(appKind({ properties: { appType: "CanvasApp" } }), "canvas");
  assert.equal(appKind({ appType: "Model-driven" }), "model");
  assert.equal(appKind({ type: "CodeApp" }), "code");
  assert.equal(appKind({ name: "Code App", type: "Microsoft.PowerApps/apps" }), "unknown");
  assert.equal(appKind({ properties: { isManaged: true } }), "unknown");
});

test("aggregates all accessible environments and all pages, deduplicating within each environment", async () => {
  const requests = [];
  const options = { accessToken: "mock-token", fetchImpl: async (input) => {
    const url = new URL(input);
    requests.push(url.pathname + url.search);
    if (url.pathname === "/environmentmanagement/environments") {
      return url.searchParams.has("page") ? json({ value: [{ name: "env-two" }] }) : json({
        value: [{ name: "env-one" }],
        "@odata.nextLink": "https://api.powerplatform.com/environmentmanagement/environments?page=2"
      });
    }
    if (url.pathname.endsWith("/websites")) return json({ value: [{ id: "site" }] });
    if (url.pathname.includes("env-two")) return json({ value: [{ name: "model", appType: "ModelDrivenApp" }] });
    if (url.searchParams.has("page")) return json({ value: [
      { name: "canvas", appType: "CanvasApp" }, { name: "code", appType: "CodeApp" }
    ] });
    return json({
      value: [{ name: "canvas", appType: "CanvasApp" }],
      nextLink: "https://api.powerplatform.com/powerapps/environments/env-one/apps?page=2"
    });
  } };
  const result = await loadApplicationSummary(options);
  assert.deepEqual({ total: result.total, canvas: result.canvas, model: result.model, code: result.code, pages: result.pages },
    { total: 5, canvas: 1, model: 1, code: 1, pages: 2 });
  assert.equal(result.environments, 2);
  assert.equal(result.completed, 2);
  assert.equal(result.errors.length, 0);
  assert.equal(requests.length, 7);
});

test("marks permission failures and unknown types, without inventing counts", async () => {
  const summary = await loadApplicationSummary({
    accessToken: "mock-token", fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/environments")) return json({ value: [{ id: "env" }] });
      if (url.pathname.endsWith("/websites")) return json({ error: { code: "Forbidden", message: "No access" } }, 403);
      return json({ value: [{ name: "app", type: "Microsoft.PowerApps/apps" }] });
    }
  });
  assert.equal(summary.unknown, 1);
  assert.equal(summary.appSuccess, 1);
  assert.equal(summary.siteSuccess, 0);
  assert.match(summary.errors[0], /HTTP 403/);
});

test("summary loader excludes trigger/action endpoints and exposes unsupported modules", async () => {
  const options = { accessToken: "mock-token", fetchImpl: async () => assert.fail("Unexpected tenant call") };
  assert.equal((await loadModuleSummary("monitoring-hub", options)).unsupported, true);
  assert.equal((await loadModuleSummary("copilot-studio", options)).unsupported, true);
});

test("loads passive module summaries with counts and surfaces individual failures", async () => {
  const result = await loadModuleSummary("authorization", {
    accessToken: "mock-token", fetchImpl: async (input) => new URL(input).pathname.endsWith("roleAssignments")
      ? json({ value: [{ id: "one" }] })
      : json({ error: { code: "Forbidden", message: "Missing permission" } }, 403)
  });
  assert.equal(result.resources[0].count, 1);
  assert.match(result.resources[1].error, /HTTP 403/);
});

test("cancellation prevents further environment requests", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadApplicationSummary({
    accessToken: "mock-token", signal: controller.signal,
    fetchImpl: async (_url, { signal }) => { signal.throwIfAborted(); }
  }), { name: "AbortError" });
});

test("repeated continuation links fail explicitly rather than inflating counts", async () => {
  const nextLink = "https://api.powerplatform.com/environmentmanagement/environments?page=2";
  await assert.rejects(loadApplicationSummary({
    accessToken: "mock-token",
    fetchImpl: async () => json({ value: [{ id: "env" }], nextLink })
  }), /Pagination repeated/);
});

test("deduplicates repeated environment rows and surfaces failed subsequent inventory pages", async () => {
  let appsRequests = 0;
  const summary = await loadApplicationSummary({
    accessToken: "mock-token", fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/environments")) return json({ value: [{ id: "env" }, { id: "env" }] });
      if (url.pathname.endsWith("/websites")) return json({ value: [] });
      appsRequests++;
      if (url.searchParams.has("page")) return json({ error: { code: "Forbidden", message: "No access" } }, 403);
      return json({ value: [{ id: "one", appType: "Canvas" }],
        nextLink: "https://api.powerplatform.com/powerapps/environments/env/apps?page=2" });
    }
  });
  assert.equal(appsRequests, 2);
  assert.equal(summary.environments, 1);
  assert.equal(summary.appSuccess, 0);
  assert.equal(summary.siteSuccess, 1);
  assert.equal(summary.errors.length, 1);
});
