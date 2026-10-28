import test from "node:test";
import assert from "node:assert/strict";
import { API_SECTIONS, getSectionById } from "../api-catalog.js";
import {
  buildApiUrl,
  extractRows,
  extractNextLink,
  getApiErrorDescription,
  HttpApiError,
  pollAcceptedOperation,
  requestPowerPlatformApi,
  validateNextLink
} from "../api-client.js";

const environmentSection = getSectionById("environment-management");

test("catalog contains each documented permission namespace", () => {
  assert.ok(API_SECTIONS.length >= 16);
  assert.ok(API_SECTIONS.every((section) => section.resourceGroups.length > 0));
  assert.equal(new Set(API_SECTIONS.map((section) => section.namespace)).size, API_SECTIONS.length);
  assert.ok(API_SECTIONS.some((section) => section.title === "Monitoring Hub"));
  for (const section of API_SECTIONS) {
    assert.equal(
      section.resourceGroupCount,
      section.resourceGroups.length
    );
    assert.equal(
      section.operationCount,
      section.resourceGroups.reduce((count, resource) => count + resource.operations.length, 0)
    );
    assert.ok(section.resourceGroups.flatMap((resource) => resource.operations)
      .every((operation) => operation.docsUrl.startsWith("https://learn.microsoft.com/")));
  }
});

test("catalog resolves a request template for every indexed operation", () => {
  const operations = API_SECTIONS.flatMap((section) =>
    section.resourceGroups.flatMap((resource) => resource.operations)
  );
  assert.ok(operations.length > 200);
  assert.ok(operations.every((operation) =>
    ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(operation.method) &&
    typeof operation.path === "string" &&
    Boolean(operation.apiVersion) &&
    operation.docsUrl.startsWith("https://learn.microsoft.com/")
  ));
});

test("builds a namespace-scoped URL with the documented API version", () => {
  const url = buildApiUrl(environmentSection, "environments?$top=20", "2024-10-01");
  assert.equal(
    url.href,
    "https://api.powerplatform.com/environmentmanagement/environments?%24top=20&api-version=2024-10-01"
  );
});

test("requires an API version and blocks routes outside the selected namespace", () => {
  assert.throws(() => buildApiUrl(environmentSection, "environments", ""), /API version/);
  assert.throws(
    () => buildApiUrl(environmentSection, "../../licensing/billingPolicies", "2024-10-01"),
    /selected API namespace/
  );
  assert.throws(
    () => buildApiUrl(environmentSection, "https://example.com/data", "2024-10-01"),
    /selected API namespace/
  );
  assert.throws(
    () => buildApiUrl(environmentSection, "environments/{environmentId}", "2024-10-01"),
    /replace any \{parameter\} placeholders/
  );
});

test("rejects a conflicting api-version query parameter", () => {
  assert.throws(
    () => buildApiUrl(environmentSection, "environments?api-version=2022-01-01", "2024-10-01"),
    /conflicts/
  );
});

test("follows only next links in the selected Power Platform namespace", () => {
  const next = validateNextLink(
    environmentSection,
    "https://api.powerplatform.com/environmentmanagement/environments?$skip=10"
  );
  assert.equal(next.searchParams.get("$skip"), "10");
  assert.throws(
    () => validateNextLink(environmentSection, "https://example.com/collect"),
    /outside the selected namespace/
  );
});

test("extracts OData rows and next links", () => {
  const data = {
    value: [{ id: "env-1" }],
    "@odata.nextlink": "https://api.powerplatform.com/environmentmanagement/environments?skip=1"
  };
  assert.deepEqual(extractRows(data), [{ id: "env-1" }]);
  assert.equal(extractNextLink(data), data["@odata.nextlink"]);
  assert.equal(extractNextLink({ "@odata.nextLink": "https://example.test/next" }), "https://example.test/next");
  assert.equal(extractNextLink({ nextLink: "https://example.test/apps" }), "https://example.test/apps");
  assert.deepEqual(extractRows({ message: "no collection" }), []);
});

test("sends a delegated token and parses JSON success without logging credentials", async () => {
  let request;
  const response = await requestPowerPlatformApi({
    section: environmentSection,
    path: "environments",
    apiVersion: "2024-10-01",
    accessToken: "test-token",
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({ value: [{ id: "env-1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  assert.equal(request.init.headers.get("authorization"), "Bearer test-token");
  assert.deepEqual(response.data, { value: [{ id: "env-1" }] });
  assert.equal(response.status, 200);
});

test("surfaces API status, code, message, and Retry-After", async () => {
  await assert.rejects(
    requestPowerPlatformApi({
      section: environmentSection,
      path: "environments",
      apiVersion: "2024-10-01",
      accessToken: "test-token",
      fetchImpl: async () => new Response(JSON.stringify({
        error: { code: "Forbidden", message: "Insufficient permission" }
      }), {
        status: 403,
        headers: {
          "content-type": "application/json",
          "retry-after": "5"
        }
      })
    }),
    (error) => {
      assert.ok(error instanceof HttpApiError);
      assert.equal(error.status, 403);
      assert.equal(error.code, "Forbidden");
      assert.equal(error.retryAfter, "5");
      assert.match(getApiErrorDescription(error), /Insufficient permission/);
      return true;
    }
  );
});

test("supports empty successful responses and rejects malformed JSON", async () => {
  const empty = await requestPowerPlatformApi({
    section: environmentSection,
    path: "environments/env-1",
    apiVersion: "2024-10-01",
    method: "DELETE",
    accessToken: "test-token",
    fetchImpl: async () => new Response(null, { status: 204 })
  });
  assert.equal(empty.data, undefined);
  await assert.rejects(
    requestPowerPlatformApi({
      section: environmentSection,
      path: "environments",
      apiVersion: "2024-10-01",
      accessToken: "test-token",
      fetchImpl: async () => new Response("{", {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    }),
    /malformed JSON/
  );
});

test("polls a 202 operation using its Location and Retry-After headers", async () => {
  const section = getSectionById("environment-management");
  let requests = 0;
  const result = await pollAcceptedOperation({
    section,
    response: {
      status: 202,
      url: "https://api.powerplatform.com/environmentmanagement/operations",
      headers: new Headers({
        location: "https://api.powerplatform.com/environmentmanagement/operations/op-1",
        "retry-after": "0"
      })
    },
    accessToken: "test-token",
    fetchImpl: async (url, init) => {
      requests += 1;
      assert.equal(String(url), "https://api.powerplatform.com/environmentmanagement/operations/op-1");
      assert.equal(init.method, "GET");
      return new Response(JSON.stringify({
        status: requests === 1 ? "Running" : "Succeeded"
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "retry-after": "0"
        }
      });
    }
  });
  assert.equal(requests, 2);
  assert.equal(result.data.status, "Succeeded");
});

test("treats a terminal asynchronous failure as an error", async () => {
  await assert.rejects(
    pollAcceptedOperation({
      section: environmentSection,
      response: {
        status: 202,
        headers: new Headers({
          location: "https://api.powerplatform.com/environmentmanagement/operations/op-2",
          "retry-after": "0"
        })
      },
      accessToken: "test-token",
      fetchImpl: async () => new Response(JSON.stringify({
        status: "Failed",
        error: { code: "OperationFailed", message: "The operation could not complete." }
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "retry-after": "0"
        }
      })
    }),
    (error) => {
      assert.ok(error instanceof HttpApiError);
      assert.equal(error.code, "OperationFailed");
      assert.match(error.message, /could not complete/);
      return true;
    }
  );
});

test("allows cancellation while waiting between asynchronous polls", async () => {
  const controller = new AbortController();
  const operation = pollAcceptedOperation({
    section: environmentSection,
    response: {
      status: 202,
      headers: new Headers({
        location: "https://api.powerplatform.com/environmentmanagement/operations/op-3",
        "retry-after": "5"
      })
    },
    accessToken: "test-token",
    signal: controller.signal,
    fetchImpl: async () => {
      throw new Error("Polling should not start after cancellation.");
    }
  });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(operation, { name: "AbortError" });
});
