import { requestReport } from "../pp-reporting-api-demo/reporting-client.mjs";

export function consumptionMarkup() {
  return `
    <div class="section-heading"><div><h2>Consumption</h2><p>Copilot Studio licensing reports</p></div></div>
    <section class="panel">
      <h3>Copilot credit consumption</h3>
      <p class="form-hint">Load BillingDetailsPerEnvironment consumption data with Daily or Summary granularity.</p>
      <button id="open-consumption" type="button" class="button button-primary">Load consumption data</button>
      <div id="consumption-content" class="hidden">
        <p class="notice warning">Preview: requires a tenant-enabled North America home-geo tenant and a Global, Power Platform, or Dynamics 365 administrator in that tenant. Use a separate delegated token for https://service.flow.microsoft.com/. The admin console's Power Platform token is not supported.</p>
        <form id="consumption-form" class="request-form">
          <div class="field"><label for="consumption-tenant">Tenant ID</label><input id="consumption-tenant" required autocomplete="off" spellcheck="false"></div>
          <div class="field"><label for="consumption-token">Delegated Power Automate token</label><input id="consumption-token" type="password" required autocomplete="off"><span class="form-hint">Obtain through an approved secure workflow. Kept in memory only; never saved or logged.</span></div>
          <div class="field"><label for="consumption-start">Start date</label><input id="consumption-start" type="date" required></div>
          <div class="field"><label for="consumption-end">End date</label><input id="consumption-end" type="date" required></div>
          <div class="field"><label for="consumption-granularity">Granularity</label><select id="consumption-granularity"><option>Daily</option><option>Summary</option></select></div>
          <div class="submit-row"><button id="consumption-submit" class="button button-primary" type="submit">Request report</button><button id="consumption-cancel" class="button button-quiet" type="button" disabled>Cancel</button></div>
        </form>
        <p id="consumption-status" class="form-hint" role="status" aria-live="polite"></p>
        <p id="consumption-error" class="request-error hidden" role="alert"></p>
        <div id="consumption-results" class="hidden">
          <p id="consumption-summary" class="form-hint"></p>
          <a id="consumption-download" class="button button-quiet">Download .csv.gz</a>
          <div class="table-wrap"><table><thead id="consumption-head"></thead><tbody id="consumption-body"></tbody></table></div>
        </div>
      </div>
    </section>`;
}

export function bindConsumption(root, { tenantId = "", request = requestReport, mock = false, beginLoading = () => () => {} } = {}) {
  const find = (id) => root.querySelector(`#consumption-${id}`);
  const form = find("form");
  const token = find("token");
  const status = find("status");
  const errorPanel = find("error");
  let controller;
  let downloadUrl;
  let countdown;
  let disposed = false;
  let finishLoading;

  find("tenant").value = tenantId;
  if (mock) {
    find("tenant").value = "00000000-0000-4000-8000-000000000001";
    token.required = false;
    token.disabled = true;
    token.placeholder = "Not needed for local mock data";
  }
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  find("start").value = start.toISOString().slice(0, 10);
  find("end").value = end.toISOString().slice(0, 10);

  const clearDownload = () => {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = undefined;
    find("download").removeAttribute("href");
  };
  const clearCountdown = () => {
    clearInterval(countdown);
    countdown = undefined;
  };
  const setBusy = (busy) => {
    for (const element of form.elements) element.disabled = busy;
    if (mock) token.disabled = true;
    find("cancel").disabled = !busy;
  };

  root.querySelector("#open-consumption").addEventListener("click", () => {
    find("content").classList.remove("hidden");
    find("tenant").focus();
  });
  find("cancel").addEventListener("click", () => controller?.abort());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (controller || disposed) return;
    controller = new AbortController();
    finishLoading = beginLoading("Loading consumption report…");
    const active = controller;
    setBusy(true);
    errorPanel.classList.add("hidden");
    find("results").classList.add("hidden");
    find("head").replaceChildren();
    find("body").replaceChildren();
    clearDownload();
    try {
      const result = await request({
        tenantId: find("tenant").value.trim(),
        token: token.value,
        startDate: find("start").value,
        endDate: find("end").value,
        granularity: find("granularity").value
      }, {
        signal: active.signal,
        onState: (update) => {
          if (disposed) return;
          clearCountdown();
          status.dataset.phase = update.phase;
          status.textContent = update.message;
          if (update.phase === "waiting") {
            const deadline = Date.now() + update.retryAfter * 1000;
            countdown = setInterval(() => {
              const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
              status.textContent = `Report generation running. Next check in ${remaining} seconds.`;
            }, 250);
          }
        }
      });
      if (disposed || active.signal.aborted) return;
      const document = root.ownerDocument;
      const header = document.createElement("tr");
      for (const label of result.headers) {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.textContent = label;
        header.append(cell);
      }
      find("head").append(header);
      for (const row of result.rows.slice(0, 100)) {
        const tr = document.createElement("tr");
        for (const value of row) {
          const cell = document.createElement("td");
          cell.textContent = value;
          tr.append(cell);
        }
        find("body").append(tr);
      }
      downloadUrl = URL.createObjectURL(result.archive);
      find("download").href = downloadUrl;
      find("download").download = result.fileName;
      find("summary").textContent = `${result.rows.length} rows loaded; showing the first ${Math.min(100, result.rows.length)}. Download the original archive for all rows.`;
      find("results").classList.remove("hidden");
    } catch (error) {
      if (!disposed) {
        status.dataset.phase = error?.name === "AbortError" ? "cancelled" : "failed";
        status.textContent = error?.name === "AbortError" ? "Report cancelled." : "Report failed.";
        if (error?.name !== "AbortError") {
          errorPanel.textContent = error instanceof Error ? error.message : String(error);
          errorPanel.classList.remove("hidden");
        }
      }
    } finally {
      finishLoading?.();
      clearCountdown();
      token.value = "";
      controller = undefined;
      if (!disposed) setBusy(false);
    }
  });

  return () => {
    finishLoading?.();
    disposed = true;
    controller?.abort();
    clearCountdown();
    clearDownload();
    token.value = "";
    find("head").replaceChildren();
    find("body").replaceChildren();
  };
}
