import { ReportingApiError, requestReport } from "./reporting-client.mjs";
import { renderCreditChart } from "./credit-chart.mjs";
import { formatReportDate } from "./report-date.mjs";

const config = window.REPORTING_CLIENT_CONFIG ?? {};
const form = document.querySelector("#report-form");
const tenantInput = document.querySelector("#tenant-id");
const tokenInput = document.querySelector("#access-token");
const startDateInput = document.querySelector("#start-date");
const endDateInput = document.querySelector("#end-date");
const granularityInput = document.querySelector("#granularity");
const submitButton = document.querySelector("#submit-report");
const cancelButton = document.querySelector("#cancel-report");
const statusPanel = document.querySelector("#status");
const generationIndicator = document.querySelector("#generation-indicator");
const pollCountdown = document.querySelector("#poll-countdown");
const pollProgress = document.querySelector("#poll-progress");
const pollTime = document.querySelector("#poll-time");
const errorPanel = document.querySelector("#error");
const userLabel = document.querySelector("#user-label");
const resultsPanel = document.querySelector("#results");
const emptyResultsPanel = document.querySelector("#empty-results");
const resultSummary = document.querySelector("#result-summary");
const tableHead = document.querySelector("#report-head");
const tableBody = document.querySelector("#report-body");
const downloadLink = document.querySelector("#download-report");
const creditChart = document.querySelector("#credit-chart");
const chartMessage = document.querySelector("#chart-message");

let activeController;
let downloadObjectUrl;
let pollTimer;

initialize().catch((error) => {
  updateStatus({ phase: "failed", message: "The startup token could not be loaded." });
  errorPanel.textContent = error instanceof Error ? error.message : "Unexpected startup error.";
  errorPanel.hidden = false;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearResults();
  errorPanel.hidden = true;
  activeController = new AbortController();
  setBusy(true);

  try {
    const result = await requestReport({
      tenantId: tenantInput.value.trim(),
      token: tokenInput.value,
      startDate: startDateInput.value,
      endDate: endDateInput.value,
      granularity: granularityInput.value
    }, {
      signal: activeController.signal,
      onState: updateStatus
    });
    renderResult(result);
  } catch (error) {
    if (error?.name === "AbortError") {
      updateStatus({ phase: "cancelled", message: "Request cancelled." });
    } else {
      const message = error instanceof ReportingApiError
        ? error.message
        : "An unexpected client error occurred.";
      updateStatus({ phase: "failed", message: "The request failed." });
      errorPanel.textContent = message;
      errorPanel.hidden = false;
    }
  } finally {
    activeController = undefined;
    setBusy(false);
  }
});

cancelButton.addEventListener("click", () => {
  activeController?.abort(new DOMException("The request was cancelled.", "AbortError"));
});

window.addEventListener("beforeunload", () => {
  tokenInput.value = "";
  activeController?.abort();
  stopPollCountdown();
  revokeDownloadUrl();
});

async function initialize() {
  tenantInput.value = config.tenantId ?? "";
  userLabel.textContent = config.userPrincipalName
    ? `Sign in as ${config.userPrincipalName}.`
    : "Sign in with a tenant administrator account.";

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 6);
  endDateInput.value = toDateInput(endDate);
  startDateInput.value = toDateInput(startDate);
  updateStatus({ phase: "ready", message: "Ready to request a report." });
  await loadBootstrapToken();
}

async function loadBootstrapToken() {
  const bootstrapNonce = new URLSearchParams(location.hash.slice(1)).get("bootstrap");
  if (!bootstrapNonce) {
    return;
  }

  history.replaceState(null, "", `${location.pathname}${location.search}`);
  const response = await fetch("/session-token", {
    method: "POST",
    headers: { "X-Bootstrap-Nonce": bootstrapNonce },
    cache: "no-store",
    redirect: "error"
  });
  if (!response.ok) {
    throw new Error(`The local server rejected the startup token handoff (HTTP ${response.status}).`);
  }

  const body = await response.json();
  if (typeof body.accessToken !== "string" || !body.accessToken) {
    throw new Error("The local server did not provide a valid startup token.");
  }

  tokenInput.value = body.accessToken;
  updateStatus({ phase: "ready", message: "Ready. The delegated token was loaded securely." });
}

function updateStatus({ phase, message, retryAfter }) {
  statusPanel.dataset.phase = phase;
  statusPanel.textContent = message;
  generationIndicator.hidden = !["submitting", "waiting", "downloading"].includes(phase);

  if (phase === "waiting" && Number.isFinite(retryAfter)) {
    startPollCountdown(retryAfter);
  } else {
    stopPollCountdown();
  }
}

function startPollCountdown(durationSeconds) {
  stopPollCountdown();

  const startedAt = Date.now();
  const durationMilliseconds = durationSeconds * 1000;
  pollProgress.max = Math.max(durationSeconds, 1);
  pollProgress.value = 0;
  pollCountdown.hidden = false;

  const updateCountdown = () => {
    const elapsedMilliseconds = Math.min(Date.now() - startedAt, durationMilliseconds);
    const remainingSeconds = Math.max(
      0,
      Math.ceil((durationMilliseconds - elapsedMilliseconds) / 1000)
    );
    pollProgress.value = elapsedMilliseconds / 1000;
    pollTime.value = `${formatDuration(remainingSeconds)} remaining`;

    if (elapsedMilliseconds >= durationMilliseconds) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };

  updateCountdown();
  if (durationSeconds > 0) {
    pollTimer = setInterval(updateCountdown, 250);
  }
}

function stopPollCountdown() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
  pollCountdown.hidden = true;
  pollProgress.value = 0;
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function setBusy(busy) {
  for (const element of form.elements) {
    if (element !== cancelButton) {
      element.disabled = busy;
    }
  }
  cancelButton.disabled = !busy;
}

function renderResult({ archive, fileName, headers, rows }) {
  const headerRow = document.createElement("tr");
  for (const header of headers) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = header;
    headerRow.append(cell);
  }
  tableHead.replaceChildren(headerRow);

  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const tableRow = document.createElement("tr");
    for (const [index, value] of row.entries()) {
      const cell = document.createElement("td");
      cell.textContent = headers[index] === "BilledDate" ? formatReportDate(value) : value;
      tableRow.append(cell);
    }
    fragment.append(tableRow);
  }
  tableBody.replaceChildren(fragment);
  try {
    renderCreditChart(creditChart, headers, rows);
    chartMessage.textContent = rows.length ? "" : "No report rows to chart.";
  } catch (error) {
    creditChart.replaceChildren();
    chartMessage.textContent = `Chart unavailable: ${error.message}`;
  }

  revokeDownloadUrl();
  downloadObjectUrl = URL.createObjectURL(archive);
  downloadLink.href = downloadObjectUrl;
  downloadLink.download = fileName;
  resultSummary.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"} in ${fileName}`;
  resultsPanel.hidden = false;
  emptyResultsPanel.hidden = true;
}

function clearResults() {
  revokeDownloadUrl();
  tableHead.replaceChildren();
  tableBody.replaceChildren();
  creditChart.replaceChildren();
  chartMessage.textContent = "";
  resultsPanel.hidden = true;
  emptyResultsPanel.hidden = false;
}

function revokeDownloadUrl() {
  if (downloadObjectUrl) {
    URL.revokeObjectURL(downloadObjectUrl);
    downloadObjectUrl = undefined;
  }
}

function toDateInput(date) {
  return date.toISOString().slice(0, 10);
}
