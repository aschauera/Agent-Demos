import test from "node:test";
import assert from "node:assert/strict";
import { connectionPresentation, createMockFetch, mockConsumption } from "../session-mode.js";
import { decompressGzip } from "../../pp-reporting-api-demo/reporting-client.mjs";

test("connection presentation distinguishes mock, live disconnected, connected, and expired sessions", () => {
  assert.equal(connectionPresentation("live", "token", 200, 100).connected, true);
  for (const [mode, token, expiry] of [
    ["mock", "token", 200], ["live", undefined, 200], ["live", "token", 99],
    ["live", "token", undefined]
  ]) {
    assert.equal(connectionPresentation(mode, token, expiry, 100).connected, false);
  }
  assert.match(connectionPresentation("mock").label, /Mock data/);
  assert.equal(connectionPresentation("live").label, "Not connected");
});

test("mock transport supplies local environments and package data, filters states, and rejects unsupported operations", async () => {
  const fetchMock = createMockFetch();
  const environments = await (await fetchMock("https://api.powerplatform.com/environmentmanagement/environments")).json();
  assert.equal(environments.value.length, 2);
  const packages = await (await fetchMock("https://api.powerplatform.com/appmanagement/environments/mock-production/applicationPackages?appInstallState=Installed")).json();
  assert.equal(packages.value.length, 1);
  assert.equal(packages.value[0].state, "Installed");
  await assert.rejects(fetchMock("https://api.powerplatform.com/appmanagement/applicationPackages", { method: "POST" }), /read-only/);
  await assert.rejects(fetchMock("https://api.powerplatform.com/unknown/resource"), /No sample data/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchMock("https://api.powerplatform.com/environmentmanagement/environments", { signal: controller.signal }), { name: "AbortError" });
});

test("mock consumption returns explicitly labeled sample CSV and a valid gzip download", async () => {
  const result = await mockConsumption({});
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.every((row) => row[2] === "Mock"));
  assert.match(await decompressGzip(result.archive), /Sample Production,120,Mock/);
});
