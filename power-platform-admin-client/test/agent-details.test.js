import test from "node:test";
import assert from "node:assert/strict";
import { agentKey, agentOperationPath, agentDetailsMarkup, friendlyMetadataLabel, friendlyMetadataValue,
  agentOperationFields, agentOperationRequest } from "../agent-details.js";
import { getSectionById } from "../api-catalog.js";
import { requestPowerPlatformApi } from "../api-client.js";

const section = getSectionById("copilot-studio");
const row = {
  agent: { id: "/providers/agents/inventory-id", name: "inventory-id", environmentId: "outer-env" },
  properties: { name: "bot-id", environmentId: "bot-env", displayName: "Support <agent>",
    isQuarantined: false, channels: ["Teams"], capabilities: { count: 2 } },
  kind: "standard", source: "properties.harness"
};

test("details form shows escaped metadata, booleans and complex values read-only", () => {
  const markup = agentDetailsMarkup(row, section);
  assert.match(markup, /Support &lt;agent&gt;/);
  assert.match(markup, /readonly value="No"/);
  assert.match(markup, /Published channels/);
  assert.match(markup, /<li><span>Teams<\/span><\/li>/);
  assert.match(markup, /Inventory · Resource ID/);
  assert.match(markup, /<legend>Capabilities<\/legend>/);
  assert.match(markup, /readonly value="2"/);
  assert.doesNotMatch(markup, /JSON|&quot;count&quot;|&quot;Teams&quot;/);
  assert.match(markup, /Back to agents/);
  assert.doesNotMatch(markup, /<input(?![^>]*readonly)/);
});

test("renders a button for every documented namespace operation", () => {
  const markup = agentDetailsMarkup(row, section);
  const operations = section.resourceGroups.flatMap((group) => group.operations);
  assert.equal((markup.match(/class="button [^"]+ agent-operation"/g) || []).length, operations.length);
  for (const operation of operations) assert.ok(markup.includes(operation.title));
  assert.ok(markup.startsWith('<div class="hero"><h1>Support &lt;agent&gt;</h1></div>'));
  assert.doesNotMatch(markup.match(/<div class="hero">.*?<\/div>/s)[0], /<p>|hero-tag/);
  assert.ok(markup.indexOf('class="hero"') < markup.indexOf('class="agent-ribbon"'));
  assert.ok(markup.indexOf('class="agent-ribbon"') < markup.indexOf('class="agent-metadata"'));
  assert.match(markup, /aria-label="Agent management"/);
  assert.match(markup, /aria-label="Evaluations"/);
  assert.match(markup, /metadata-technical"><summary>/);
  assert.ok(markup.indexOf('class="ribbon-group-label"') < markup.indexOf('class="agent-operation-buttons"'));
});

test("friendly labels cover common metadata and convert unfamiliar field names", () => {
  assert.equal(friendlyMetadataLabel("displayName"), "Agent name");
  assert.equal(friendlyMetadataLabel("ownerId"), "Owner ID");
  assert.equal(friendlyMetadataLabel("sharedWithViewers"), "Viewer access");
  assert.equal(friendlyMetadataLabel("someAPISetting"), "Some API Setting");
  assert.equal(friendlyMetadataLabel("custom_url"), "Custom URL");
});

test("friendly values distinguish missing data, zero, booleans and valid local dates", () => {
  assert.equal(friendlyMetadataValue("isQuarantined", true), "Yes");
  assert.equal(friendlyMetadataValue("isQuarantined", false), "No");
  assert.equal(friendlyMetadataValue("count", 0), "0");
  for (const value of [null, undefined, ""]) assert.equal(friendlyMetadataValue("ownerId", value), "Not provided");
  const date = "2026-10-28T12:00:00Z";
  assert.equal(friendlyMetadataValue("createdAt", date),
    new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(date)));
  assert.equal(friendlyMetadataValue("createdAt", "invalid-date"), "invalid-date");
  assert.equal(friendlyMetadataValue("description", date), date);
});

test("renders nested collections without JSON and preserves escaped text and unique control IDs", () => {
  const markup = agentDetailsMarkup({ ...row, properties: {
    displayName: "Agent", sharedWithViewers: { entireTenant: true, userCount: 0 },
    powerPlatformConnectors: [{ connectorId: "shared_teams", displayName: "<script>alert(1)</script>" }],
    channels: [], customProperty: {}, ownerId: null
  } }, section);
  assert.match(markup, /Everyone in the organization/);
  assert.match(markup, /readonly value="Yes"/);
  assert.match(markup, /readonly value="0"/);
  assert.match(markup, /None listed/);
  assert.match(markup, /No details provided/);
  assert.match(markup, /Not provided/);
  assert.match(markup, /&lt;script&gt;/);
  assert.doesNotMatch(markup, /<script>|&quot;connectorId&quot;/);
  const ids = [...markup.matchAll(/id="(agent-metadata-\d+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  const labels = [...markup.matchAll(/for="(agent-metadata-\d+)"/g)].map((match) => match[1]);
  assert.deepEqual(labels, ids);
});

test("operation routes use Dataverse bot and environment identifiers and preserve remaining parameters", () => {
  const operations = section.resourceGroups.flatMap((group) => group.operations);
  for (const operation of operations) {
    const path = agentOperationPath(operation, row);
    assert.ok(path.includes("environments/bot-env/"));
    assert.ok(path.includes("/bots/bot-id/") || path.includes("/agents/bot-id/"));
    assert.ok(!path.includes("inventory-id"));
    for (const placeholder of operation.path.match(/\{[^}]+\}/g) || []) {
      if (!["{EnvironmentId}", "{BotId}", "{AgentId}"].includes(placeholder)) assert.ok(path.includes(placeholder));
    }
  }
});

test("never substitutes ARG resource IDs for missing bot IDs", () => {
  const operation = { path: "environments/{EnvironmentId}/bots/{BotId}/api/botQuarantine" };
  assert.equal(agentOperationPath(operation, { agent: { id: "/resource/path" }, properties: {} }), operation.path);
  assert.equal(agentOperationPath(operation, { agent: { name: "a/b", environmentId: "e?f" }, properties: {} }),
    "environments/e%3Ff/bots/a%2Fb/api/botQuarantine");
  assert.equal(agentKey(row), row.agent.id);
});

test("builds and sends direct requests for every documented ribbon operation", async () => {
  const operations = section.resourceGroups.flatMap((group) => group.operations);
  for (const operation of operations) {
    const inputs = Object.fromEntries(agentOperationFields(operation, row).map((field) => [
      field.name, field.name === "NewOwnerAadUserId" ? "11111111-1111-4111-8111-111111111111" :
        field.choices ? field.choices.find((value) => value !== "") : "test-id"
    ]));
    const request = agentOperationRequest(operation, row, inputs);
    await requestPowerPlatformApi({
      section, ...request, accessToken: "mock", fetchImpl: async (url, init) => {
        assert.equal(init.method, operation.method);
        assert.ok(new URL(url).pathname.startsWith("/copilotstudio/environments/bot-env/"));
        assert.doesNotMatch(new URL(url).pathname, /[{}]/);
        if (operation.id === "reassign-copilot-agent") {
          assert.deepEqual(JSON.parse(init.body), { NewOwnerAadUserId: inputs.NewOwnerAadUserId });
        } else if (operation.id === "set-connector-consent-bypass") {
          assert.deepEqual(JSON.parse(init.body), { adminConsentBypass: false });
        } else if (operation.id === "run-maker-evaluation-test-set") {
          assert.deepEqual(JSON.parse(init.body), { evaluationRunName: "test-id", mcsConnectionId: "test-id", runOnPublishedBot: false });
        } else {
          assert.equal(init.body, undefined);
        }
        return new Response(null, { status: 204 });
      }
    });
  }
});

test("validates focused action values and preserves exact documented boolean bodies", () => {
  const operation = (id) => section.resourceGroups.flatMap((group) => group.operations).find((item) => item.id === id);
  assert.deepEqual(agentOperationFields(operation("get-bot-quarantine-status"), row), []);
  assert.throws(() => agentOperationRequest(operation("set-connector-consent-bypass"), row), /required/);
  assert.throws(() => agentOperationRequest(operation("set-connector-consent-bypass"), row, { adminConsentBypass: "maybe" }), /valid value/);
  assert.deepEqual(agentOperationRequest(operation("set-connector-consent-bypass"), row, { adminConsentBypass: "true" }).body,
    { adminConsentBypass: true });
  assert.throws(() => agentOperationRequest(operation("reassign-copilot-agent"), row, { NewOwnerAadUserId: "bad" }), /GUID/);
  assert.throws(() => agentOperationRequest(operation("get-maker-evaluation-test-run"), row, { TestRunId: "../other" }), /valid TestRunId/);
  assert.throws(() => agentOperationRequest(operation("get-maker-evaluation-test-run"), row), /required/);
  const download = agentOperationRequest(operation("download-agent-channel-manifest"), row,
    { ChannelName: "M365", includeAgentSchema: "true" });
  assert.match(download.path, /channels\/M365\/download\?includeAgentSchema=true/);
  assert.equal(download.responseType, "blob");
});

test("download requests preserve ZIP bytes and still surface JSON API errors", async () => {
  const operation = section.resourceGroups.flatMap((group) => group.operations).find((item) => item.id === "download-maker-evaluation-snapshot");
  const options = { section, ...agentOperationRequest(operation, row, { TestRunId: "test-run" }), accessToken: "mock" };
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x80]);
  const response = await requestPowerPlatformApi({
    ...options, fetchImpl: async () => new Response(bytes, { headers: { "content-type": "application/zip" } })
  });
  assert.ok(response.data instanceof Blob);
  assert.deepEqual(new Uint8Array(await response.data.arrayBuffer()), bytes);
  await assert.rejects(requestPowerPlatformApi({
    ...options, fetchImpl: async () => new Response('{"error":{"message":"No access"}}',
      { status: 403, headers: { "content-type": "application/json" } })
  }), (error) => error.status === 403 && error.message === "No access");
});
