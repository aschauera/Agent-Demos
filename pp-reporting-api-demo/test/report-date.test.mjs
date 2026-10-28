import assert from "node:assert/strict";
import test from "node:test";
import { formatReportDate } from "../report-date.mjs";
import { createCreditChartData } from "../credit-chart.mjs";

test("formats dates and timestamps as date only using regional conventions", () => {
  for (const value of ["2026-10-01", "2026-10-01T00:00:00Z", "2026-10-01T23:30:00-07:00"]) {
    assert.equal(formatReportDate(value, "en-US"), "10/1/2026");
    assert.equal(formatReportDate(value, "de-AT"), "1.10.2026");
    assert.equal(formatReportDate(value, "en-GB"), "01/10/2026");
  }
});

test("preserves blank and invalid dates rather than showing a different date", () => {
  for (const value of ["", undefined, "not a date", "2026-02-30", "2026-10-01Tinvalid"]) {
    assert.equal(formatReportDate(value, "en-US"), value);
  }
});

test("chart labels use the same date-only formatter without modifying source rows", () => {
  const rows = [["2026-10-01T00:00:00Z", "10", "5"]];
  const result = createCreditChartData(
    ["BilledDate", "PrepaidConsumedQuantity", "PayGoConsumedQuantity"], rows
  );
  assert.equal(result.items[0].label, `Row 1 - ${formatReportDate(rows[0][0])}`);
  assert.equal(result.items[0].category, formatReportDate(rows[0][0]));
  assert.equal(rows[0][0], "2026-10-01T00:00:00Z");
});
