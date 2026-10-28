import test from "node:test";
import assert from "node:assert/strict";
import { bindConsumption, consumptionMarkup } from "../consumption.js";

function fixture() {
  const elements = new Map();
  const element = () => ({
    value: "", textContent: "", dataset: {}, children: [], events: {},
    classList: {
      values: new Set(["hidden"]),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); }
    },
    addEventListener(name, handler) { this.events[name] = handler; },
    removeAttribute(name) { delete this[name]; },
    replaceChildren(...children) { this.children = children; },
    append(child) { this.children.push(child); },
    focus() {}
  });
  const root = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
    ownerDocument: { createElement: element }
  };
  const find = (id) => root.querySelector(`#consumption-${id}`);
  find("form").elements = ["tenant", "token", "start", "end", "granularity", "submit"]
    .map(find);
  find("granularity").value = "Daily";
  return { root, find };
}

test("consumption tile explains the separate preview authentication requirement", () => {
  assert.match(consumptionMarkup(), /Load consumption data/);
  assert.match(consumptionMarkup(), /North America/);
  assert.match(consumptionMarkup(), /Power Platform token is not supported/);
});

test("consumption loads report, renders CSV as text, and clears token and download", async () => {
  const { root, find } = fixture();
  let input;
  const dispose = bindConsumption(root, {
    tenantId: "tenant-default",
    request: async (request, options) => {
      input = request;
      options.onState({ phase: "complete", message: "Report complete." });
      return {
        archive: new Blob(["archive"]), fileName: "report.csv.gz",
        headers: ["Environment"], rows: [["<script>untrusted</script>"]]
      };
    }
  });
  assert.equal(find("tenant").value, "tenant-default");
  find("token").value = "separate-report-token";
  await find("form").events.submit({ preventDefault() {} });
  assert.equal(input.token, "separate-report-token");
  assert.equal(input.granularity, "Daily");
  assert.equal(find("token").value, "");
  assert.equal(find("body").children[0].children[0].textContent, "<script>untrusted</script>");
  assert.equal(find("download").download, "report.csv.gz");
  assert.match(find("download").href, /^blob:/);
  dispose();
  assert.equal(find("download").href, undefined);
  assert.equal(find("body").children.length, 0);
});

test("consumption surfaces API errors and clears credentials after failure", async () => {
  const { root, find } = fixture();
  const dispose = bindConsumption(root, {
    request: async () => { throw new Error("HTTP 403 - AccessDenied"); }
  });
  find("token").value = "separate-report-token";
  await find("form").events.submit({ preventDefault() {} });
  assert.equal(find("status").dataset.phase, "failed");
  assert.match(find("error").textContent, /HTTP 403 - AccessDenied/);
  assert.equal(find("token").value, "");
  dispose();
});

test("leaving consumption cancels polling and ignores late completion", async () => {
  const { root, find } = fixture();
  let signal;
  const dispose = bindConsumption(root, {
    request: async (_input, options) => {
      signal = options.signal;
      await new Promise((resolve, reject) => signal.addEventListener("abort",
        () => reject(new DOMException("Cancelled", "AbortError")), { once: true }));
    }
  });
  find("token").value = "separate-report-token";
  const pending = find("form").events.submit({ preventDefault() {} });
  dispose();
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(find("token").value, "");
  assert.equal(find("body").children.length, 0);
});
