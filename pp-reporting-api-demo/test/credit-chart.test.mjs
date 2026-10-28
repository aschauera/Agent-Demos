import assert from "node:assert/strict";
import test from "node:test";
import { createCreditChartData } from "../credit-chart.mjs";
import { formatReportDate } from "../report-date.mjs";

const headers = [
  "EnvironmentName", "PrepaidConsumedQuantity", "PayGoConsumedQuantity", "BilledDate"
];

test("keeps prepaid and paygo separate for every daily row in table order", () => {
  assert.deepEqual(createCreditChartData(headers, [
    ["Demo", "12.5", "3.25", "2026-10-01"],
    ["Demo", "0", "25", "2026-10-02"]
  ]), {
    items: [
      { label: `Row 1 - Demo - ${formatReportDate("2026-10-01")}`,
        category: formatReportDate("2026-10-01"), prepaid: 12.5, payGo: 3.25 },
      { label: `Row 2 - Demo - ${formatReportDate("2026-10-02")}`,
        category: formatReportDate("2026-10-02"), prepaid: 0, payGo: 25 }
    ],
    minimum: 0,
    maximum: 25
  });
});

test("supports summary rows, reordered columns and environment ID fallback", () => {
  assert.deepEqual(createCreditChartData(
    ["PayGoConsumedQuantity", "EnvironmentId", "PrepaidConsumedQuantity"],
    [["7", "env-1", "15"]]
  ).items, [{ label: "Row 1 - env-1", category: "Row 1", prepaid: 15, payGo: 7 }]);
});

test("supports empty reports, all-zero values and negative adjustments", () => {
  assert.deepEqual(createCreditChartData(headers, []), { items: [], minimum: 0, maximum: 0 });
  const zeros = createCreditChartData(headers, [["Demo", "0", "0", ""]]);
  assert.equal(zeros.maximum, 0);
  const signed = createCreditChartData(headers, [["Demo", "-5", "10", ""]]);
  assert.equal(signed.minimum, -5);
  assert.equal(signed.maximum, 10);
});

test("rejects missing consumption columns and invalid values instead of charting zeros", () => {
  assert.throws(() => createCreditChartData(["EnvironmentName"], []), /must include/);
  for (const value of ["", " ", "abc", "Infinity", undefined]) {
    assert.throws(() => createCreditChartData(headers, [["Demo", value, "2", ""]]),
      /Row 1 has an invalid PrepaidConsumedQuantity/);
    assert.throws(() => createCreditChartData(headers, [["Demo", "2", value, ""]]),
      /Row 1 has an invalid PayGoConsumedQuantity/);
  }
});
