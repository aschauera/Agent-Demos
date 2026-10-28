import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { beginAuthorization, completeAuthorization } from "../auth.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

test("callback accepts no options when invoked by the browser app", async (t) => {
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.sessionStorage;
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previousStorage;
  });
  globalThis.window = { location: { search: "", pathname: "/", hash: "" }, history: {} };
  globalThis.sessionStorage = memoryStorage();
  assert.equal(await completeAuthorization(), undefined);
});

test("builds an authorization-code PKCE request without a client secret", async () => {
  const storage = memoryStorage();
  let destination;
  await beginAuthorization({
    tenantId: "11111111-1111-4111-8111-111111111111",
    clientId: "22222222-2222-4222-8222-222222222222",
    redirectUri: "http://localhost:8080/",
    storage,
    cryptoApi: webcrypto,
    location: { assign: (url) => { destination = url; } }
  });
  const url = new URL(destination);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("code_challenge"));
  assert.equal(url.searchParams.has("client_secret"), false);
  assert.ok(storage.getItem("pp-admin-auth-flow"));
});

test("validates OAuth state and keeps the returned token out of storage", async () => {
  const storage = memoryStorage();
  const flow = {
    state: "safe-state",
    verifier: "pkce-verifier",
    tenantId: "11111111-1111-4111-8111-111111111111",
    clientId: "22222222-2222-4222-8222-222222222222",
    redirectUri: "http://localhost:8080/",
    scope: "https://api.powerplatform.com/.default"
  };
  storage.setItem("pp-admin-auth-flow", JSON.stringify(flow));
  let cleanUrl;
  const result = await completeAuthorization({
    search: "?code=one-time-code&state=safe-state",
    storage,
    fetchImpl: async (_url, init) => {
      assert.equal(init.body.get("code_verifier"), "pkce-verifier");
      return new Response(JSON.stringify({ access_token: "memory-only", expires_in: 300 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    history: { replaceState: (_state, _title, url) => { cleanUrl = url; } },
    location: { pathname: "/", hash: "" }
  });
  assert.equal(result.accessToken, "memory-only");
  assert.equal(storage.getItem("pp-admin-auth-flow"), null);
  assert.equal(cleanUrl, "/");
});

test("rejects an OAuth state mismatch before exchanging the code", async () => {
  const storage = memoryStorage();
  storage.setItem("pp-admin-auth-flow", JSON.stringify({
    state: "expected",
    verifier: "verifier",
    tenantId: "tenant",
    clientId: "client",
    redirectUri: "http://localhost:8080/",
    scope: "scope"
  }));
  await assert.rejects(
    completeAuthorization({
      search: "?code=one-time-code&state=unexpected",
      storage,
      fetchImpl: async () => { throw new Error("must not exchange"); },
      history: { replaceState() {} },
      location: { pathname: "/", hash: "" }
    }),
    /state validation failed/
  );
});
