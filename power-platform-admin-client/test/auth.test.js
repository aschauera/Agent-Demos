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

test("owner-name opt-in requests offline access without combining resource scopes", async () => {
  for (const enabled of [false, true]) {
    const storage = memoryStorage();
    let destination;
    await beginAuthorization({
      tenantId: "11111111-1111-4111-8111-111111111111",
      clientId: "22222222-2222-4222-8222-222222222222",
      redirectUri: "http://localhost:8080/",
      resolveOwnerNames: enabled,
      storage, cryptoApi: webcrypto, location: { assign: (url) => { destination = url; } }
    });
    const scope = new URL(destination).searchParams.get("scope");
    assert.equal(scope.includes("offline_access"), enabled);
    assert.doesNotMatch(scope, /graph\.microsoft\.com/);
    assert.equal(JSON.parse(storage.getItem("pp-admin-auth-flow")).resolveOwnerNames, enabled);
  }
});

const ownerFlow = (enabled = true) => ({
  state: "owner-state", verifier: "owner-verifier",
  tenantId: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  redirectUri: "http://localhost:8080/",
  scope: `https://api.powerplatform.com/.default${enabled ? " offline_access" : ""}`,
  resolveOwnerNames: enabled
});

async function completeOwnerFlow(fetchImpl, enabled = true) {
  const storage = memoryStorage();
  storage.setItem("pp-admin-auth-flow", JSON.stringify(ownerFlow(enabled)));
  const auth = await completeAuthorization({
    search: "?code=owner-code&state=owner-state", storage, fetchImpl,
    history: { replaceState() {} }, location: { pathname: "/", hash: "" }
  });
  assert.equal(storage.getItem("pp-admin-auth-flow"), null);
  return auth;
}

test("owner-name sign-in obtains separate access tokens and never persists or returns refresh tokens", async () => {
  const grants = [];
  const auth = await completeOwnerFlow(async (_url, { body }) => {
    grants.push(body.get("grant_type"));
    if (body.get("grant_type") === "authorization_code") {
      assert.equal(body.get("scope"), "https://api.powerplatform.com/.default offline_access");
      return new Response(JSON.stringify({ access_token: "platform-token", refresh_token: "temporary-refresh", expires_in: 300 }));
    }
    assert.equal(body.get("scope"), "https://graph.microsoft.com/.default");
    assert.equal(body.get("refresh_token"), "temporary-refresh");
    return new Response(JSON.stringify({ access_token: "directory-token", refresh_token: "rotated-refresh", expires_in: 120 }));
  });
  assert.deepEqual(grants, ["authorization_code", "refresh_token"]);
  assert.equal(auth.accessToken, "platform-token");
  assert.equal(auth.ownerAccessToken, "directory-token");
  assert.ok(auth.ownerExpiresAt < auth.expiresAt);
  assert.doesNotMatch(JSON.stringify(auth), /temporary-refresh|rotated-refresh/);
});

test("Graph consent errors and missing refresh tokens preserve Power Platform sign-in with an explicit warning", async () => {
  let calls = 0;
  const auth = await completeOwnerFlow(async () => {
    calls++;
    return calls === 1
      ? new Response(JSON.stringify({ access_token: "platform-token", refresh_token: "temporary-refresh" }))
      : new Response(JSON.stringify({ error_description: "Admin consent is required." }), { status: 400 });
  });
  assert.equal(auth.accessToken, "platform-token");
  assert.equal(auth.ownerAccessToken, undefined);
  assert.match(auth.ownerNameError, /Admin consent is required.*Directory.Read.All/);
  assert.doesNotMatch(JSON.stringify(auth), /temporary-refresh/);

  const withoutRefresh = await completeOwnerFlow(async () => new Response(JSON.stringify({ access_token: "platform-token" })));
  assert.equal(withoutRefresh.accessToken, "platform-token");
  assert.match(withoutRefresh.ownerNameError, /did not issue a refresh token/);
});

test("owner-name opt-out skips Graph token acquisition", async () => {
  let calls = 0;
  const auth = await completeOwnerFlow(async () => {
    calls++;
    return new Response(JSON.stringify({ access_token: "platform-token", refresh_token: "not-used" }));
  }, false);
  assert.equal(calls, 1);
  assert.equal(auth.ownerAccessToken, undefined);
  assert.match(auth.ownerNameError, /disabled/);
  assert.doesNotMatch(JSON.stringify(auth), /not-used/);
});

test("invalid Graph token responses are reported without damaging the platform session", async () => {
  for (const graphData of [null, [], { access_token: "directory-token", expires_in: 0 }]) {
    let calls = 0;
    const auth = await completeOwnerFlow(async () => {
      calls++;
      return new Response(JSON.stringify(calls === 1
        ? { access_token: "platform-token", refresh_token: "temporary-refresh" } : graphData));
    });
    assert.equal(auth.accessToken, "platform-token");
    assert.equal(auth.ownerAccessToken, undefined);
    assert.match(auth.ownerNameError, /invalid token/);
  }
});
