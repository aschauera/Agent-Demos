import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readLocalConnection, saveLocalConnection, forgetLocalConnection } from "../local-settings.js";

const ids = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222"
};
const storage = () => {
  const items = new Map();
  return {
    items, getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value), removeItem: (key) => items.delete(key)
  };
};

test("saving connection persists only opted-in IDs, never tokens or arbitrary fields", () => {
  const local = storage();
  assert.equal(readLocalConnection(local), undefined);
  saveLocalConnection(local, { ...ids, accessToken: "must-not-persist", scope: "not-saved" });
  assert.deepEqual(readLocalConnection(local), ids);
  assert.deepEqual(JSON.parse([...local.items.values()][0]), ids);
  forgetLocalConnection(local);
  assert.equal(readLocalConnection(local), undefined);
});

test("invalid IDs, malformed saved data and unavailable storage fail explicitly", () => {
  const local = storage();
  assert.throws(() => saveLocalConnection(local, { ...ids, tenantId: "invalid" }), /valid.*GUIDs/);
  assert.equal(local.items.size, 0);
  local.items.set("pp-admin.connection", "{");
  assert.throws(() => readLocalConnection(local), SyntaxError);
  const blocked = {
    getItem() { throw new Error("Storage blocked"); },
    setItem() { throw new Error("Storage blocked"); },
    removeItem() { throw new Error("Storage blocked"); }
  };
  assert.throws(() => readLocalConnection(blocked), /Storage blocked/);
  assert.throws(() => saveLocalConnection(blocked, ids), /Storage blocked/);
  assert.throws(() => forgetLocalConnection(blocked), /Storage blocked/);
});

test("file-based connection overrides are git-ignored and not tracked", () => {
  const cwd = new URL("../../", import.meta.url);
  const path = "power-platform-admin-client/config.local.js";
  assert.match(execFileSync("git", ["check-ignore", "--no-index", path], { cwd, encoding: "utf8" }), /config\.local\.js/);
  assert.equal(execFileSync("git", ["ls-files", "--", path], { cwd, encoding: "utf8" }).trim(), "");
});
