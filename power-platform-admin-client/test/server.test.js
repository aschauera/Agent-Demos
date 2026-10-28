import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server.mjs";
import { readFile } from "node:fs/promises";

test("serves the local console with restrictive security headers", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy"), /connect-src 'self' https:\/\/api\.powerplatform\.com/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const html = await response.text();
  assert.match(html, /<title>The Bridge<\/title>/);
  assert.match(html, /Managed Platform Command Center/);
  assert.match(html, /aria-label="The Bridge home"/);

  const config = await fetch(`${baseUrl}/config.local.js`);
  assert.equal(config.status, 200);
  assert.match(await config.text(), /PP_ADMIN_CONFIG/);
});

test("serves health checks and rejects non-allowlisted routes and methods", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("x-pp-admin-client"), "local");
  assert.deepEqual(await health.json(), { service: "power-platform-admin-client" });
  assert.equal((await fetch(`${baseUrl}/README.md`)).status, 404);
  assert.equal((await fetch(baseUrl, { method: "POST" })).status, 405);
});

test("serves the shared reporting module without exposing reporting configuration", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}/pp-reporting-api-demo/reporting-client.mjs`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /javascript/);
  assert.match(response.headers.get("content-security-policy"), /https:\/\/preview\.api\.flow\.microsoft\.com/);
  assert.equal(await response.text(), await readFile(
    new URL("../../pp-reporting-api-demo/reporting-client.mjs", import.meta.url), "utf8"
  ));
  assert.equal((await fetch(`${baseUrl}/pp-reporting-api-demo/config.local.js`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/session-token`, { method: "POST" })).status, 405);
  assert.equal((await fetch(`${baseUrl}/consumption.js`)).status, 200);
  for (const module of ["app-management.js", "app-management-api.js", "application-inventory.js", "session-mode.js", "module-summary.js", "local-settings.js", "agent-details.js", "tenant-overview.js", "charts.js"]) {
    const asset = await fetch(`${baseUrl}/${module}`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type"), /javascript/);
  }
});
