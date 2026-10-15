import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import test from "node:test";
import {
  parseCsv,
  requestReport,
  ReportingApiError,
  validateRequest,
  withApiVersion
} from "../reporting-client.mjs";

const validInput = {
  tenantId: "00000000-0000-4000-8000-000000000000",
  token: "test-token",
  startDate: "2026-09-01",
  endDate: "2026-09-30",
  granularity: "Daily"
};

test("validates tenant ID and date order", () => {
  assert.throws(
    () => validateRequest({ ...validInput, tenantId: "invalid" }),
    /valid GUID/
  );
  assert.throws(
    () => validateRequest({ ...validInput, startDate: "2026-10-01" }),
    /on or after/
  );
});

test("adds the API version without replacing an existing version", () => {
  assert.match(withApiVersion("https://example.test/operation"), /api-version=2016-11-01/);
  assert.equal(
    withApiVersion("https://example.test/operation?api-version=future"),
    "https://example.test/operation?api-version=future"
  );
});

test("parses quoted commas, quotes, and line breaks", () => {
  const result = parseCsv('Name,Notes\r\n"Example, Inc.","Said ""hello""\nagain"\r\n');
  assert.deepEqual(result, {
    headers: ["Name", "Notes"],
    rows: [["Example, Inc.", 'Said "hello"\nagain']]
  });
});

test("rejects malformed CSV", () => {
  assert.throws(() => parseCsv('Name,Notes\n"broken,value'), /unterminated/);
  assert.throws(() => parseCsv("Name,Notes\none"), /expected 2/);
});

test("follows running, success, and download responses", async () => {
  const states = [];
  const waits = [];
  const requests = [];
  const csv = "EnvironmentId,EnvironmentName\r\nenv-1,\"Demo, Environment\"\r\n";
  const responses = [
    response("", {
      status: 202,
      headers: { Location: "https://example.test/operation/1", "Retry-After": "3" }
    }),
    response({ status: "Running" }, { headers: { "Retry-After": "7" } }),
    response(
      { status: "Succeeded", fileName: "report.csv.gz" },
      { headers: { Location: "https://example.test/files/report.csv.gz" } }
    ),
    response(gzipSync(csv))
  ];

  const result = await requestReport(validInput, {
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return responses.shift();
    },
    wait: async (seconds) => waits.push(seconds),
    onState: (state) => states.push(state.phase)
  });

  assert.deepEqual(waits, [3, 7]);
  assert.deepEqual(states, ["submitting", "waiting", "waiting", "downloading", "complete"]);
  assert.equal(requests.length, 4);
  assert.equal(requests[0].init.headers.Authorization, "Bearer test-token");
  assert.ok(requests.slice(1).every(({ url }) => url.includes("api-version=2016-11-01")));
  assert.deepEqual(result.headers, ["EnvironmentId", "EnvironmentName"]);
  assert.deepEqual(result.rows, [["env-1", "Demo, Environment"]]);
});

test("surfaces terminal failure details", async () => {
  const responses = [
    response("", {
      status: 202,
      headers: { Location: "https://example.test/operation/1", "Retry-After": "0" }
    }),
    response({ status: "Failed", error: "Generation unavailable." })
  ];

  await assert.rejects(
    requestReport(validInput, {
      fetchImpl: async () => responses.shift(),
      wait: async () => {}
    }),
    /Generation unavailable/
  );
});

test("surfaces structured API errors", async () => {
  await assert.rejects(
    requestReport(validInput, {
      fetchImpl: async () => response(
        { error: { code: "InsufficientPermissions", message: "Administrator role required." } },
        { status: 403 }
      )
    }),
    (error) => {
      assert.ok(error instanceof ReportingApiError);
      assert.equal(error.status, 403);
      assert.equal(error.code, "InsufficientPermissions");
      assert.match(error.message, /Administrator role required/);
      return true;
    }
  );
});

test("supports cancellation while waiting", async () => {
  const controller = new AbortController();
  const pending = requestReport(validInput, {
    fetchImpl: async () => response("", {
      status: 202,
      headers: { Location: "https://example.test/operation/1", "Retry-After": "300" }
    }),
    signal: controller.signal
  });

  controller.abort(new DOMException("Cancelled", "AbortError"));
  await assert.rejects(pending, (error) => error.name === "AbortError");
});

test("rejects malformed gzip downloads", async () => {
  const responses = [
    response("", {
      status: 202,
      headers: { Location: "https://example.test/operation/1", "Retry-After": "0" }
    }),
    response(
      { status: "Succeeded", fileName: "report.csv.gz" },
      { headers: { Location: "https://example.test/files/report.csv.gz" } }
    ),
    response("not gzip")
  ];

  await assert.rejects(
    requestReport(validInput, {
      fetchImpl: async () => responses.shift(),
      wait: async () => {}
    }),
    /valid gzip/
  );
});

function response(body, init = {}) {
  const normalizedBody = typeof body === "object" && !ArrayBuffer.isView(body) && !(body instanceof Blob)
    ? JSON.stringify(body)
    : body;
  return new Response(normalizedBody, {
    status: init.status ?? 200,
    headers: {
      ...(typeof body === "object" && !ArrayBuffer.isView(body) ? { "Content-Type": "application/json" } : {}),
      ...init.headers
    }
  });
}
