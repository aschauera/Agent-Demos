import test from "node:test";
import assert from "node:assert/strict";
import { agentHarness, agentProperties, loadCopilotSummary } from "../module-summary.js";
import { createMockFetch } from "../session-mode.js";

const agent = (id, properties = {}) => ({ id, name: id, type: "microsoft.copilotstudio/agents", properties });
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json" }
});

test("direct harness metadata takes precedence over derived signals", () => {
  assert.equal(agentHarness(agent("a", { harness: "GitHub Copilot" })).kind, "github");
  assert.equal(agentHarness(agent("a", { harness: "GitHub Copilot Harness" })).kind, "github");
  assert.equal(agentHarness(agent("a", { harness: "Standard", isCLIAgent: true })).kind, "standard");
  assert.equal(agentHarness(agent("a", { harness: "Copilot Chat" })).kind, "chat");
  assert.equal(agentHarness(agent("a", { harness: "Future Harness", isCLIAgent: false })).kind, "unknown");
});

test("derives legacy harness using documented CLI/model/authoring signals", () => {
  for (const isCLIAgent of [true, "true"]) {
    assert.equal(agentHarness(agent("a", { isCLIAgent, model: "Microsoft 365 Copilot" })).kind, "github");
  }
  assert.equal(agentHarness(agent("a", { isCLIAgent: false, model: "Microsoft 365 Copilot" })).kind, "chat");
  assert.equal(agentHarness(agent("a", { createdIn: "Microsoft 365 Copilot Agent Builder" })).kind, "chat");
  assert.equal(agentHarness(agent("a", { isCLIAgent: false })).kind, "standard");
  assert.equal(agentHarness(agent("a", { createdIn: "Copilot Studio" })).kind, "standard");
  assert.equal(agentHarness(agent("a")).kind, "unknown");
  assert.equal(agentHarness({ ...agent("Standard"), properties: undefined }).kind, "unknown");
});

test("accepts stringified ARG properties and rejects malformed property bags", () => {
  assert.equal(agentHarness(agent("a", '{"harness":"Standard"}')).kind, "standard");
  assert.deepEqual(agentProperties(agent("a", null)), {});
  assert.throws(() => agentProperties(agent("a", "{")), SyntaxError);
  assert.throws(() => agentProperties(agent("a", [])), /Invalid agent inventory/);
});

test("uses documented structured read-only query and pages via POST SkipToken", async () => {
  const requests = [];
  const progress = [];
  const result = await loadCopilotSummary({
    accessToken: "mock-token",
    fetchImpl: async (input, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      assert.equal(new URL(input).pathname, "/resourcequery/resources/query");
      assert.equal(new URL(input).searchParams.get("api-version"), "2024-10-01");
      assert.equal(init.method, "POST");
      assert.equal(body.TableName, "PowerPlatformResources");
      assert.deepEqual(body.Clauses[0], {
        $type: "where", FieldName: "type", Operator: "in~", Values: ["'microsoft.copilotstudio/agents'"]
      });
      assert.equal(body.Options.Top, 1000);
      assert.equal(body.Options.Skip, undefined);
      return body.Options.SkipToken
        ? json({ data: [agent("a", { harness: "GitHub Copilot" }), agent("b", { isCLIAgent: false }),
          agent("c", { model: "Microsoft 365 Copilot" }), agent("d")], totalRecords: 4, resultTruncated: 1 })
        : json({ data: [agent("a", { harness: "GitHub Copilot" })], skipToken: "next", totalRecords: 4, resultTruncated: 0 });
    }
  }, (snapshot) => progress.push(snapshot));
  assert.equal(requests[0].Options.SkipToken, undefined);
  assert.equal(requests[1].Options.SkipToken, "next");
  assert.equal(result.rows.length, 4);
  assert.deepEqual([result.github, result.standard, result.chat, result.unknown], [1, 1, 1, 1]);
  assert.equal(result.pages, 2);
  assert.equal(progress[0].rows.length, 1);
});

test("empty successful inventory yields genuine zeroes", async () => {
  const result = await loadCopilotSummary({
    accessToken: "mock", fetchImpl: async () => json({ data: [], totalRecords: 0, resultTruncated: 1 })
  });
  assert.equal(result.rows.length, 0);
  assert.equal(result.standard, 0);
});

test("query permission failures are explicit, not empty agent inventories", async () => {
  await assert.rejects(loadCopilotSummary({
    accessToken: "mock", fetchImpl: async () => json({ error: { code: "Forbidden", message: "Missing inventory permission" } }, 403)
  }), (error) => error.status === 403 && /Missing inventory permission/.test(error.message));
});

test("retains progress when a subsequent inventory page fails", async () => {
  let partial;
  let count = 0;
  await assert.rejects(loadCopilotSummary({
    accessToken: "mock", fetchImpl: async () => ++count === 1
      ? json({ data: [agent("a", { harness: "Standard" })], skipToken: "next" })
      : json({ error: { message: "Throttled" } }, 429)
  }, (snapshot) => { partial = snapshot; }), (error) => error.status === 429);
  assert.equal(partial.standard, 1);
});

test("rejects malformed, truncated and repeated-token query responses", async () => {
  for (const data of [
    { value: [] }, { data: [null] }, { data: [agent("a", "invalid json")] },
    { data: [], resultTruncated: 0 }, { data: [], totalRecords: 10 },
    { data: [], skipToken: 123 }, { data: [], skipToken: "repeated" }
  ]) {
    await assert.rejects(loadCopilotSummary({ accessToken: "mock", fetchImpl: async () => json(data) }));
  }
});

test("cancellation stops before requesting another inventory page", async () => {
  const controller = new AbortController();
  let requests = 0;
  await assert.rejects(loadCopilotSummary({
    accessToken: "mock", signal: controller.signal, fetchImpl: async () => {
      requests++;
      return json({ data: [agent("a")], skipToken: "next" });
    }
  }, () => controller.abort()), { name: "AbortError" });
  assert.equal(requests, 1);
});

test("ignores an in-flight response arriving after cancellation", async () => {
  const controller = new AbortController();
  await assert.rejects(loadCopilotSummary({
    accessToken: "mock", signal: controller.signal, fetchImpl: async () => {
      controller.abort();
      return json({ data: [agent("a", { harness: "Standard" })] });
    }
  }, () => assert.fail("Cancelled data must not update the overview")), { name: "AbortError" });
});

test("mock mode serves the read-only agent query but still blocks mutations", async () => {
  const result = await loadCopilotSummary({ accessToken: "mock", fetchImpl: createMockFetch() });
  assert.deepEqual([result.github, result.standard, result.chat, result.unknown], [1, 1, 1, 1]);
  await assert.rejects(createMockFetch()("https://api.powerplatform.com/copilotstudio/bots", { method: "POST" }), /read-only/);
});
