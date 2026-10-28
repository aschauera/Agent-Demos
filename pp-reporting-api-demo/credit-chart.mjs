import { formatReportDate } from "./report-date.mjs";

export function createCreditChartData(headers, rows) {
  const prepaidIndex = headers.indexOf("PrepaidConsumedQuantity");
  const payGoIndex = headers.indexOf("PayGoConsumedQuantity");
  if (prepaidIndex < 0 || payGoIndex < 0) {
    throw new Error("The report must include PrepaidConsumedQuantity and PayGoConsumedQuantity.");
  }

  const environmentIndex = headers.indexOf("EnvironmentName");
  const environmentIdIndex = headers.indexOf("EnvironmentId");
  const dateIndex = headers.indexOf("BilledDate");
  const items = rows.map((row, index) => {
    const values = [prepaidIndex, payGoIndex].map((column) => {
      const raw = row[column]?.trim();
      const value = Number(raw);
      if (!raw || !Number.isFinite(value)) {
        throw new Error(`Row ${index + 1} has an invalid ${headers[column]} value.`);
      }
      return value;
    });
    const label = [
      `Row ${index + 1}`,
      row[environmentIndex] || row[environmentIdIndex],
      formatReportDate(row[dateIndex])
    ].filter(Boolean).join(" - ");
    const category = formatReportDate(row[dateIndex]) || `Row ${index + 1}`;
    return { label, category, prepaid: values[0], payGo: values[1] };
  });
  let minimum = 0;
  let maximum = 0;
  for (const { prepaid, payGo } of items) {
    minimum = Math.min(minimum, prepaid, payGo);
    maximum = Math.max(maximum, prepaid, payGo);
  }
  return { items, minimum, maximum };
}

export function renderCreditChart(container, headers, rows) {
  const { items, minimum, maximum } = createCreditChartData(headers, rows);
  const fragment = document.createDocumentFragment();
  const formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 20 });
  const range = maximum - minimum || 1;
  const baseline = -minimum / range * 100;

  for (const { label, category, prepaid, payGo } of items) {
    const item = document.createElement("li");
    item.className = "credit-chart-row";
    item.title = label;
    const heading = document.createElement("p");
    heading.className = "credit-chart-label";
    heading.textContent = category;
    const bars = document.createElement("div");
    bars.className = "credit-chart-bars";
    bars.setAttribute("role", "group");
    bars.setAttribute("aria-label", label);

    for (const [series, name, value] of [
      ["prepaid", "Prepaid", prepaid],
      ["paygo", "Pay-as-you-go", payGo]
    ]) {
      const barRow = document.createElement("div");
      barRow.className = "credit-chart-series";
      const caption = document.createElement("span");
      caption.className = "credit-chart-value";
      caption.textContent = `${name}: ${formatter.format(value)} credits`;
      const track = document.createElement("div");
      track.className = "credit-chart-track";
      track.setAttribute("aria-hidden", "true");
      track.style.setProperty("--baseline", `${baseline}%`);
      const bar = document.createElement("span");
      bar.className = `credit-chart-bar ${series}`;
      bar.style.bottom = `${(Math.min(0, value) - minimum) / range * 100}%`;
      bar.style.height = `${Math.abs(value) / range * 100}%`;
      track.append(bar);
      barRow.append(track, caption);
      bars.append(barRow);
    }
    item.append(bars, heading);
    fragment.append(item);
  }
  container.replaceChildren(fragment);
}
