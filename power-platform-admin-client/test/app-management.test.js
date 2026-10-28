import test from "node:test";
import assert from "node:assert/strict";
import { createAppManagementApi, packagePage, summarizePackages, assertInstallStatus } from "../app-management-api.js";
import { createAppManagementState } from "../app-management.js";
import { API_SECTIONS, getSectionById } from "../api-catalog.js";

test("labels the App Management API as Dynamics solutions throughout the UI catalog", () => {
  const section = getSectionById("app-management");
  assert.equal(section.title, "Dynamics solutions");
  assert.equal(section.namespace, "appmanagement");
  assert.equal(API_SECTIONS.find((entry) => entry.id === section.id), section);
});

test("labels Dynamics as Finance and Operations without changing its API routes", () => {
  const section = getSectionById("dynamics");
  assert.equal(section.title, "Finance and Operations");
  assert.equal(section.namespace, "dynamics");
});

const operationId = "11111111-2222-4333-8444-555555555555";
const json = (data, options = {}) => new Response(JSON.stringify(data), {
  ...options, headers: { "content-type": "application/json", ...options.headers }
});

test("app management calls all four documented operations with exact schemas", async () => {
  const requests = [];
  const api = createAppManagementApi({
    accessToken: "mock-token",
    fetchImpl: async (url, init) => {
      requests.push({ url: new URL(url), init });
      return json({ value: [] });
    }
  });
  await api.tenantPackages();
  await api.environmentPackages({ environmentId: "Default-environment", appInstallState: "Installed", lcid: "1033" });
  await api.install({ environmentId: "Default-environment", uniqueName: "Publisher.App", payloadValue: '{"locale":1033}' });
  await api.status({ environmentId: "Default-environment", operationId });
  assert.deepEqual(requests.map(({ url }) => url.pathname), [
    "/appmanagement/applicationPackages",
    "/appmanagement/environments/Default-environment/applicationPackages",
    "/appmanagement/environments/Default-environment/applicationPackages/Publisher.App/install",
    `/appmanagement/environments/Default-environment/operations/${operationId}`
  ]);
  assert.ok(requests.every(({ url }) => url.searchParams.get("api-version") === "2024-10-01"));
  assert.equal(requests[1].url.searchParams.get("appInstallState"), "Installed");
  assert.equal(requests[1].url.searchParams.get("lcid"), "1033");
  assert.equal(requests[2].init.method, "POST");
  assert.deepEqual(JSON.parse(requests[2].init.body), { payloadValue: '{"locale":1033}' });
});

test("rejects invalid identifiers and payloads before sending requests", () => {
  const api = createAppManagementApi({ accessToken: "mock-token", fetchImpl: () => assert.fail("Invalid request sent") });
  assert.throws(() => api.environmentPackages({ environmentId: "../other" }), /environmentId/);
  assert.throws(() => api.environmentPackages({ environmentId: "" }), /environmentId/);
  assert.throws(() => api.install({ environmentId: "env", uniqueName: "{uniqueName}", payloadValue: "" }), /uniqueName/);
  assert.throws(() => api.install({ environmentId: "env", uniqueName: "app", payloadValue: {} }), /string/);
  assert.throws(() => api.status({ environmentId: "env", operationId: "not-an-id" }), /GUID/);
});

test("handles documented camel-case pagination and rejects untrusted links", async () => {
  const data = { value: [{ uniqueName: "one" }], "@odata.nextLink":
    "https://api.powerplatform.com/appmanagement/applicationPackages?api-version=2024-10-01&skip=1" };
  const page = packagePage(data);
  assert.deepEqual(page.rows, data.value);
  const api = createAppManagementApi({
    accessToken: "mock-token", fetchImpl: async (url) => {
      assert.equal(String(url), data["@odata.nextLink"]);
      return json({ value: [{ uniqueName: "two" }] });
    }
  });
  assert.equal(packagePage((await api.next(page.nextLink)).data).rows[0].uniqueName, "two");
  assert.throws(() => api.next("https://example.com/collect"), /outside/);
  assert.throws(() => packagePage({ error: "not a list" }), /invalid package collection/);
  assert.throws(() => packagePage({ value: [null] }), /invalid package collection/);
});

test("summarizes actual package states without treating available packages as installed", () => {
  const rows = [
    { publisherId: "pub1", state: "Installed" },
    { publisherId: "pub1", state: "TemplateInstalled" },
    { publisherId: "pub2", state: "Installing" },
    { publisherId: "pub2", state: "InstallFailed" },
    { publisherId: "pub2", state: "Uninstalled" },
    { state: "UninstallFailed" }
  ];
  assert.deepEqual(summarizePackages(rows), { packages: 6, publishers: 2, installed: 2, inProgress: 1, failed: 2 });
  assert.equal(summarizePackages([{ uniqueName: "available" }]).installed, 0);
  assert.equal(createAppManagementState().tenant.loaded, false);
});

test("retains accepted install response and exposes documented terminal status errors", async () => {
  const api = createAppManagementApi({
    accessToken: "mock-token", fetchImpl: async () => new Response(null, {
      status: 202, headers: { location: `https://api.powerplatform.com/appmanagement/environments/env/operations/${operationId}` }
    })
  });
  const response = await api.install({ environmentId: "env", uniqueName: "app", payloadValue: "" });
  assert.equal(response.status, 202);
  assert.ok(response.headers.get("location").endsWith(operationId));
  assert.equal(assertInstallStatus({ data: { status: "Running" } }), "Running");
  assert.equal(assertInstallStatus({ data: { status: "Succeeded" } }), "Succeeded");
  assert.throws(() => assertInstallStatus({ status: 200, data: {
    status: "Failed", error: { errorName: "InstallBlocked", message: "Missing prerequisite", errorCode: 42 }
  } }), (error) => error.code === "InstallBlocked" && /Missing prerequisite/.test(error.message));
  assert.throws(() => assertInstallStatus({ status: 200, data: { status: "Canceled" } }), /canceled/);
  assert.throws(() => assertInstallStatus({ data: { status: "Unknown" } }), /documented status/);
});

test("surfaces API authorization and throttle failures, and supports cancellation", async () => {
  for (const status of [403, 429]) {
    const api = createAppManagementApi({
      accessToken: "mock-token", fetchImpl: async () => json(
        { error: { code: "Denied", message: "Not available" } },
        { status, headers: { "retry-after": "5" } }
      )
    });
    await assert.rejects(api.tenantPackages(), (error) => error.status === status && error.retryAfter === "5");
  }
  const controller = new AbortController();
  const api = createAppManagementApi({
    accessToken: "mock-token", signal: controller.signal,
    fetchImpl: async (_url, { signal }) => {
      signal.throwIfAborted();
      assert.fail("Should be aborted");
    }
  });
  controller.abort();
  await assert.rejects(api.tenantPackages(), { name: "AbortError" });
});
