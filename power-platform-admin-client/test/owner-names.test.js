import test from "node:test";
import assert from "node:assert/strict";
import { resolveOwnerNames } from "../owner-names.js";

const ids = [
  "0f1e2d3c-1111-4aaa-8bbb-000000000001",
  "0f1e2d3c-2222-4aaa-8bbb-000000000002",
  "0f1e2d3c-3333-4aaa-8bbb-000000000003"
];
const session = { accessToken: "directory-only-token", expiresAt: Number.MAX_SAFE_INTEGER };
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" }
});

test("resolves user, group, and service-principal display names in one scoped directory request", async () => {
  let calls = 0;
  const names = await resolveOwnerNames([ids[0].toUpperCase(), ...ids], {
    ...session,
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, "https://graph.microsoft.com/v1.0/directoryObjects/getByIds");
      assert.equal(init.method, "POST");
      assert.equal(init.headers.Authorization, "Bearer directory-only-token");
      assert.deepEqual(JSON.parse(init.body), { ids });
      return json({ value: [
        { id: ids[0].toUpperCase(), displayName: " Maker ", "@odata.type": "#microsoft.graph.user", mail: "not-retained" },
        { id: ids[1], displayName: "Owners group", "@odata.type": "#microsoft.graph.group" },
        { id: ids[2], displayName: "Automation app", "@odata.type": "#microsoft.graph.servicePrincipal" }
      ] });
    }
  });
  assert.equal(calls, 1);
  assert.deepEqual([...names], [[ids[0], "Maker"], [ids[1], "Owners group"], [ids[2], "Automation app"]]);
});

test("empty ownership needs no token or directory request", async () => {
  assert.deepEqual(await resolveOwnerNames([], { fetchImpl: async () => assert.fail("No lookup expected") }), new Map());
});

test("invalid owner IDs and missing or expired Graph sessions fail before making requests", async () => {
  const options = { ...session, fetchImpl: async () => assert.fail("Invalid requests must not be sent") };
  for (const value of [undefined, ["not-an-id"], [null], Array(1001).fill(ids[0])]) {
    await assert.rejects(resolveOwnerNames(value, options), /valid directory object IDs/);
  }
  await assert.rejects(resolveOwnerNames(ids, { ...options, accessToken: undefined }), /Microsoft Graph session/);
  for (const expiresAt of [undefined, NaN, 0, Date.now() - 1]) {
    await assert.rejects(resolveOwnerNames(ids, { ...options, expiresAt }), /expired/);
  }
});

test("Graph access and throttle errors remain explicit", async () => {
  for (const status of [403, 429]) {
    await assert.rejects(resolveOwnerNames(ids, {
      ...session, fetchImpl: async () => json({ error: { message: "Directory access failed." } }, status)
    }), new RegExp(`HTTP ${status}.*Directory access failed`));
  }
});

test("malformed directory responses and unrelated IDs fail instead of substituting names", async () => {
  for (const data of [null, [], {}, { value: {} }, { value: [null] },
    { value: [{ id: "unexpected", displayName: "Wrong" }] },
    { value: [{ id: ids[0], displayName: { invalid: true } }] }]) {
    await assert.rejects(resolveOwnerNames(ids, {
      ...session, fetchImpl: async () => json(data)
    }), /valid directory object|invalid owner directory object/);
  }
});

test("deleted and limited-information objects remain unresolved without inventing display names", async () => {
  const names = await resolveOwnerNames(ids, {
    ...session, fetchImpl: async () => json({ value: [
      { id: ids[0], displayName: null }, { id: ids[1], displayName: " " }
    ] })
  });
  assert.equal(names.size, 0);
});

test("cancellation stops directory resolution before and after an in-flight response", async () => {
  const controller = new AbortController();
  await assert.rejects(resolveOwnerNames(ids, {
    ...session, signal: controller.signal,
    fetchImpl: async (_url, init) => {
      assert.equal(init.signal, controller.signal);
      controller.abort();
      return json({ value: [{ id: ids[0], displayName: "Late result" }] });
    }
  }), { name: "AbortError" });
  await assert.rejects(resolveOwnerNames(ids, {
    ...session, signal: controller.signal, fetchImpl: async () => assert.fail("Already aborted")
  }), { name: "AbortError" });
});
