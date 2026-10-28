import test from "node:test";
import assert from "node:assert/strict";
import { API_SECTIONS, APPLICATION_MODULE, NAVIGATION_MODULES } from "../api-catalog.js";
import { APP_VIEWS, appView, createInventoryState, inventoryPage, inventoryMarkup, loadInventory } from "../application-inventory.js";
import { createMockFetch } from "../session-mode.js";

test("groups Power Apps and Power Pages without duplicating or losing operations", () => {
  assert.equal(NAVIGATION_MODULES.filter((item) => item.title === "App Management").length, 1);
  assert.ok(NAVIGATION_MODULES.some((item) => item.title === "Dynamics solutions"));
  assert.ok(!NAVIGATION_MODULES.some((item) => ["power-apps", "power-pages"].includes(item.id)));
  assert.equal(APPLICATION_MODULE.operationCount, 42);
  assert.equal(NAVIGATION_MODULES.reduce((sum, item) => sum + item.operationCount, 0),
    API_SECTIONS.reduce((sum, item) => sum + item.operationCount, 0));
  assert.equal(appView("code-apps").sectionId, "power-apps");
  assert.equal(appView("managed-apps").sectionId, "power-apps");
  assert.equal(APP_VIEWS.length, 4);
});

test("lists apps and websites with exact documented namespace-scoped operations", async () => {
  const requests = [];
  for (const sectionId of ["power-apps", "power-pages"]) {
    const result = await loadInventory({
      sectionId, environmentId: "env-one", accessToken: "mock-token",
      fetchImpl: async (url, init) => {
        requests.push({ url: new URL(url), method: init.method });
        return new Response(JSON.stringify({ value: [{ name: "test" }] }), { headers: { "content-type": "application/json" } });
      }
    });
    assert.equal(result.environmentId, "env-one");
    assert.equal(result.rows.length, 1);
  }
  assert.deepEqual(requests.map(({ url }) => url.pathname), [
    "/powerapps/environments/env-one/apps", "/powerpages/environments/env-one/websites"
  ]);
  assert.ok(requests.every(({ url, method }) => method === "GET" && url.searchParams.get("api-version") === "2024-10-01"));
});

test("handles Power Apps nextLink and enforces namespace boundaries", async () => {
  const link = "https://api.powerplatform.com/powerapps/environments/env-one/apps?api-version=2024-10-01&skip=1";
  assert.equal(inventoryPage({ value: [], nextLink: link }).nextLink, link);
  const options = { sectionId: "power-apps", environmentId: "env-one", accessToken: "mock-token" };
  await loadInventory({ ...options, nextLink: link, fetchImpl: async (url) => {
    assert.equal(String(url), link);
    return new Response('{"value": []}', { headers: { "content-type": "application/json" } });
  } });
  await assert.rejects(loadInventory({ ...options, nextLink: "https://api.powerplatform.com/powerpages/environments/env-one/websites" }), /outside/);
  await assert.rejects(loadInventory({ ...options, environmentId: "../other" }), /environment ID/);
  assert.throws(() => inventoryPage({ value: [null] }), /invalid application/);
});

test("renders coverage boundaries and escaped sample inventory in each category", async () => {
  const state = createInventoryState();
  state.environmentId = "mock-env";
  for (const view of APP_VIEWS) {
    state.view = view.id;
    const key = view.sectionId === "power-pages" ? "websites" : "apps";
    state[key] = await loadInventory({
      sectionId: view.sectionId, environmentId: state.environmentId,
      accessToken: "mock-token", fetchImpl: createMockFetch()
    });
    const html = inventoryMarkup(state, true, false);
    assert.match(html, /App Management/);
    assert.match(html, /Fetch current detail/);
    if (["code-apps", "managed-apps"].includes(view.id)) {
      assert.match(html, /not a dedicated resource or type discriminator/);
    }
  }
  state.view = "power-apps";
  state.apps.rows[0].properties.displayName = "<script>alert(1)</script>";
  assert.ok(!inventoryMarkup(state, true, false).includes("<script>"));
  assert.match(inventoryMarkup(state, true, false), /&lt;script&gt;/);
});
