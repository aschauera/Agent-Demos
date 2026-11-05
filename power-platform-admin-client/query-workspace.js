import { getApiErrorDescription } from "./api-client.js";
import { escapeHtml } from "./charts.js";
import {
  SAVED_QUERIES_KEY, deleteResourceQuery, executeResourceQuery, parseResourceQuery,
  readSavedQueries, resourceQueryPage, resourceQueryTree, saveResourceQuery
} from "./resource-query.js";
import { INVENTORY_QUERY_REFERENCE, INVENTORY_SCHEMA_REFERENCE, RESOURCE_QUERY_SAMPLES } from "./resource-query-samples.js";

const PAGE_SIZE = 100;
const initialQuery = () => JSON.stringify(RESOURCE_QUERY_SAMPLES[0].query, null, 2);

export function createQueryWorkspaceState() {
  return {
    text: initialQuery(), name: RESOURCE_QUERY_SAMPLES[0].name, folder: "",
    sampleId: RESOURCE_QUERY_SAMPLES[0].id, savedId: undefined, dirty: false,
    saved: [], expanded: new Set(["learn", "saved", "learn/Microsoft Learn examples"]), focusedNode: "learn",
    result: undefined, executedQuery: undefined, executedName: undefined, seenTokens: [], tablePage: 0, resultView: "table",
    running: false, error: undefined, libraryError: undefined,
    message: "Select a Microsoft Learn sample, load a saved query, or create a new query."
  };
}

export function mountQueryWorkspace(root, {
  state, accessToken, fetchImpl = fetch, getStorage = () => window.localStorage,
  confirm = (message) => window.confirm(message), showDetail = () => {},
  recordRequest = () => {}, beginLoading = () => () => {}, claimRequest = () => () => {},
  eventTarget = window
}) {
  let disposed = false;
  let controller;
  let finishLoading;
  let releaseRequest;
  const field = (id) => root.querySelector(`#rq-${id}`);

  function remember() {
    if (field("editor")) state.text = field("editor").value;
    if (field("query-name")) state.name = field("query-name").value;
    if (field("folder")) state.folder = field("folder").value;
  }

  function loadLibrary() {
    try {
      state.saved = readSavedQueries(getStorage());
      state.libraryError = undefined;
    } catch (error) {
      state.saved = [];
      state.libraryError = `Cannot load saved queries: ${error.message}. Reload or explicitly reset this browser's saved library.`;
    }
  }

  function treeMarkup() {
    const nodes = resourceQueryTree(state.saved);
    const drawNode = (node, parent = "", level = 1) => {
      const branch = Boolean(node.children);
      const expanded = branch && state.expanded.has(node.id);
      const selected = node.sampleId ? node.sampleId === state.sampleId : node.savedId && node.savedId === state.savedId;
      return `<li role="none"><button type="button" role="treeitem" data-node="${escapeHtml(node.id)}" data-parent="${escapeHtml(parent)}"
        data-rq-action="${branch ? "toggle" : "load"}" ${node.sampleId ? `data-sample="${escapeHtml(node.sampleId)}"` : ""}
        ${node.savedId ? `data-saved="${escapeHtml(node.savedId)}"` : ""} aria-level="${level}" aria-selected="${Boolean(selected)}"
        ${branch ? `aria-expanded="${expanded}"` : `aria-disabled="${state.running}" ${state.running ? "disabled" : ""}`}
        tabindex="-1" class="rq-tree-item${branch ? " rq-tree-branch" : ""}">
        <span class="rq-tree-marker" aria-hidden="true">${branch ? expanded ? "-" : "+" : ""}</span>${escapeHtml(node.label)}</button>
        ${expanded ? `<ul role="group">${node.children.length
          ? node.children.map((child) => drawNode(child, node.id, level + 1)).join("")
          : '<li role="none" class="rq-tree-empty">No saved queries yet.</li>'}</ul>` : ""}</li>`;
    };
    return `<ul role="tree" aria-label="Resource query library">${nodes.map((node) => drawNode(node)).join("")}</ul>`;
  }

  function drawLibrary(focusNode) {
    field("tree").innerHTML = treeMarkup();
    const items = [...field("tree").querySelectorAll('[role="treeitem"]')].filter((item) => !item.disabled);
    const active = items.find((item) => item.dataset.node === (focusNode || state.focusedNode)) || items[0];
    if (active) {
      active.tabIndex = 0;
      state.focusedNode = active.dataset.node;
      if (focusNode) active.focus();
    }
    field("library-error").textContent = state.libraryError || "";
    field("library-error").classList.toggle("hidden", !state.libraryError);
    field("reset-library").classList.toggle("hidden", !state.libraryError);
    syncControls();
  }

  function drawResults() {
    const result = state.result;
    for (const view of ["table", "json"]) {
      field(`${view}-tab`).setAttribute("aria-selected", String(state.resultView === view));
      field(`${view}-tab`).tabIndex = state.resultView === view ? 0 : -1;
    }
    if (!result) {
      field("results-body").innerHTML = `<div id="rq-table-panel" role="tabpanel" aria-labelledby="rq-table-tab" ${state.resultView === "table" ? "" : "hidden"}><p class="empty-state">Execute a resource query to display its results here.</p></div>
        <div id="rq-json-panel" role="tabpanel" aria-labelledby="rq-json-tab" ${state.resultView === "json" ? "" : "hidden"}><p class="empty-state">No JSON response yet.</p></div>`;
      field("results-meta").textContent = "No query executed";
      field("more").disabled = true;
      return;
    }
    const total = result.totalRecords === undefined ? "" : ` of ${result.totalRecords.toLocaleString()} total`;
    field("results-meta").textContent = `${state.executedName} · HTTP ${result.status} · ${result.rows.length.toLocaleString()} loaded${total}`;
    const partial = result.incomplete
      ? '<p class="request-error" role="alert">These results are incomplete because usable continuation information was not returned. Revise the query or retry.</p>'
      : result.nextToken ? '<p class="form-hint">More server results are available. Load the next page to continue.</p>' : "";
    const json = result.pages.length === 1 ? result.pages[0] : { pages: result.pages };
    const columns = [...new Set(result.rows.flatMap((row) => row && typeof row === "object" && !Array.isArray(row) ? Object.keys(row) : ["Value"]))];
    const pageCount = Math.max(1, Math.ceil(result.rows.length / PAGE_SIZE));
    state.tablePage = Math.max(0, Math.min(state.tablePage, pageCount - 1));
    const offset = state.tablePage * PAGE_SIZE;
    const rows = result.rows.slice(offset, offset + PAGE_SIZE);
    const cell = (row, column) => {
      const value = row && typeof row === "object" && !Array.isArray(row) ? row[column] : row;
      return escapeHtml(value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));
    };
    const table = result.rows.length ? `<div class="table-wrap rq-table-wrap"><table><thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}<th>Actions</th></tr></thead>
      <tbody>${rows.map((row, index) => `<tr>${columns.map((column) => `<td>${cell(row, column)}</td>`).join("")}
      <td><button type="button" class="button button-quiet button-small" data-rq-action="detail" data-row="${offset + index}">Details</button></td></tr>`).join("")}</tbody></table></div>
      <div class="rq-result-pager"><span>Rows ${offset + 1}-${offset + rows.length} of ${result.rows.length} loaded</span>
        ${pageCount > 1 ? `<button type="button" class="button button-quiet button-small" data-rq-action="previous" ${state.tablePage === 0 ? "disabled" : ""}>Previous</button>
        <button type="button" class="button button-quiet button-small" data-rq-action="next" ${state.tablePage === pageCount - 1 ? "disabled" : ""}>Next</button>` : ""}</div>`
      : '<p class="empty-state">The query returned no rows.</p>';
    field("results-body").innerHTML = `${partial}<div id="rq-table-panel" role="tabpanel" aria-labelledby="rq-table-tab" ${state.resultView === "table" ? "" : "hidden"}>${table}</div>
      <div id="rq-json-panel" role="tabpanel" aria-labelledby="rq-json-tab" ${state.resultView === "json" ? "" : "hidden"}><pre class="json-view">${escapeHtml(JSON.stringify(json, null, 2))}</pre></div>`;
    field("more").disabled = state.running || !result.nextToken || !accessToken;
  }

  function syncControls() {
    if (!field("editor")) return;
    field("editor").readOnly = state.running;
    field("execute").disabled = state.running || !accessToken;
    field("cancel").disabled = !state.running;
    for (const id of ["new", "format", "query-name", "folder", "save-new"]) field(id).disabled = state.running;
    field("save").disabled = state.running || Boolean(state.libraryError);
    field("save-new").disabled = state.running || Boolean(state.libraryError);
    field("delete").disabled = state.running || !state.savedId || Boolean(state.libraryError);
    field("reset-library").disabled = state.running;
    for (const item of root.querySelectorAll('[data-rq-action="load"]')) {
      item.disabled = state.running;
      item.setAttribute("aria-disabled", String(state.running));
    }
    field("dirty").textContent = state.dirty ? "Unsaved changes" : state.savedId ? "Saved query" : state.sampleId ? "Microsoft Learn sample" : "Draft query";
    field("message").textContent = state.message;
    field("error").textContent = state.error || "";
    field("error").classList.toggle("hidden", !state.error);
    if (field("more")) field("more").disabled = state.running || !state.result?.nextToken || !accessToken;
  }

  function sourceLink() {
    const sample = RESOURCE_QUERY_SAMPLES.find((query) => query.id === state.sampleId);
    field("source").innerHTML = sample ? `<a href="${escapeHtml(sample.source)}" target="_blank" rel="noreferrer">Sample reference on Microsoft Learn</a>` : "User query · stored only when you choose Save query";
  }

  function draw() {
    root.innerHTML = `<div class="hero rq-hero"><div class="hero-tag">POWER PLATFORM RESOURCE QUERY</div><h1>My Queries</h1>
      <p>Write inventory queries, explore tenant resources, and organize the queries you use most.</p></div>
      <div class="rq-layout">
        <section class="panel rq-editor-panel" aria-labelledby="rq-editor-label">
          <div class="panel-title"><h2 id="rq-editor-label">Query editor</h2><span id="rq-dirty"></span></div>
          <div class="rq-editor-toolbar"><span class="permission-chip">JSON</span>
            <button id="rq-new" type="button" class="button button-quiet button-small" data-rq-action="new">New query</button>
            <button id="rq-format" type="button" class="button button-quiet button-small" data-rq-action="format">Format JSON</button></div>
          <form id="rq-execute-form"><label class="rq-editor-caption" for="rq-editor">Resource query request</label>
            <textarea id="rq-editor" aria-describedby="rq-editor-help" spellcheck="false" autocomplete="off" wrap="off">${escapeHtml(state.text)}</textarea>
            <p id="rq-editor-help" class="form-hint">The Power Platform API uses structured JSON clauses, not raw KQL. Edit parameters such as environment IDs before executing. Requires ResourceQuery.Resources.Read.</p>
            <div class="rq-execution-actions"><button id="rq-execute" type="submit" class="button button-primary">Execute query</button>
              <button id="rq-cancel" type="button" class="button button-danger" data-rq-action="cancel">Cancel</button>
              <span id="rq-message" class="form-hint" role="status" aria-live="polite"></span></div>
          </form>
          <div id="rq-error" class="request-error hidden" role="alert"></div>
          <p id="rq-source" class="form-hint"></p>
        </section>
        <aside class="panel rq-library-panel" aria-labelledby="rq-library-label">
          <div class="panel-title"><h2 id="rq-library-label">Query library</h2></div>
          <p class="form-hint">Choose a sample or saved query to load it into the editor.</p>
          <div id="rq-tree" class="rq-tree"></div>
          <form id="rq-save-form" class="rq-save-form">
            <div class="field"><label for="rq-query-name">Query name</label><input id="rq-query-name" required autocomplete="off" value="${escapeHtml(state.name)}"></div>
            <div class="field"><label for="rq-folder">Saved folder path (optional)</label><input id="rq-folder" autocomplete="off" placeholder="Tenant/Apps" value="${escapeHtml(state.folder)}"></div>
            <div class="request-actions"><button id="rq-save" type="submit" class="button button-primary button-small">Save query</button>
              <button id="rq-save-new" type="button" class="button button-quiet button-small" data-rq-action="save-new">Save as new</button>
              <button id="rq-delete" type="button" class="button button-quiet button-small" data-rq-action="delete">Delete saved query</button></div>
          </form>
          <p class="form-hint">Only explicitly saved query text is stored in this browser. Tokens and results are never saved. This library is not synced to the cloud.</p>
          <div id="rq-library-error" class="request-error hidden" role="alert"></div>
          <div class="request-actions"><button type="button" class="button button-quiet button-small" data-rq-action="reload-library">Reload library</button>
            <button id="rq-reset-library" type="button" class="button button-danger button-small hidden" data-rq-action="reset-library">Reset saved library</button></div>
        </aside>
      </div>
      <section id="rq-results" class="panel rq-results-panel" aria-labelledby="rq-results-label">
        <div class="panel-title"><h2 id="rq-results-label">Results</h2><span id="rq-results-meta"></span></div>
        <div class="rq-results-toolbar"><div role="tablist" aria-label="Query result format">
          <button id="rq-table-tab" type="button" role="tab" aria-controls="rq-table-panel" aria-selected="true" data-rq-action="table" class="button button-quiet button-small">Table</button>
          <button id="rq-json-tab" type="button" role="tab" aria-controls="rq-json-panel" aria-selected="false" tabindex="-1" data-rq-action="json" class="button button-quiet button-small">JSON</button></div>
          <button id="rq-more" type="button" class="button button-quiet button-small" data-rq-action="more">Load next server page</button></div>
        <div id="rq-results-body"></div>
      </section>
      <p class="form-hint rq-reference-links"><a href="${INVENTORY_QUERY_REFERENCE}" target="_blank" rel="noreferrer">Query syntax and examples</a>
        <a href="${INVENTORY_SCHEMA_REFERENCE}" target="_blank" rel="noreferrer">Power Platform resource schema</a></p>`;
    sourceLink();
    drawLibrary();
    drawResults();
  }

  function errorMessage(error, prefix = "") {
    state.error = `${prefix}${getApiErrorDescription(error)}`;
    syncControls();
  }

  function replaceDraft(text, name, folder, sampleId, savedId) {
    remember();
    if (state.dirty && !confirm("Discard unsaved query changes and load another query?")) return;
    Object.assign(state, { text, name, folder, sampleId, savedId, dirty: false, error: undefined,
      message: savedId ? "Saved query loaded. Edit and save to update it." : "Query loaded. Edit the JSON or execute it." });
    field("editor").value = text;
    field("query-name").value = name;
    field("folder").value = folder;
    sourceLink();
    drawLibrary();
    syncControls();
    field("editor").focus();
  }

  function save(asNew = false) {
    remember();
    try {
      const record = saveResourceQuery(getStorage(), {
        id: asNew ? undefined : state.savedId, name: state.name, folder: state.folder, text: state.text
      });
      Object.assign(state, { savedId: record.id, sampleId: undefined, name: record.name, folder: record.folder, dirty: false,
        error: undefined, message: "Query saved in this browser. No tokens or results were saved." });
      field("query-name").value = record.name;
      field("folder").value = record.folder;
      state.expanded.add("saved");
      let path = "";
      for (const part of record.folder ? record.folder.split("/") : []) {
        path = path ? `${path}/${part}` : part;
        state.expanded.add(`folder/${path}`);
      }
      loadLibrary();
      sourceLink();
      drawLibrary(`saved/${record.id}`);
      syncControls();
    } catch (error) {
      errorMessage(error, "Cannot save query: ");
    }
  }

  function finishOperation() {
    finishLoading?.();
    finishLoading = undefined;
    releaseRequest?.();
    releaseRequest = undefined;
  }

  async function execute(nextPage = false) {
    if (state.running) return;
    remember();
    let query;
    try {
      query = nextPage ? structuredClone(state.executedQuery) : parseResourceQuery(state.text);
      if (nextPage) {
        if (!state.result?.nextToken) throw new Error("No continuation token is available.");
        const { Skip, ...options } = query.Options || {};
        query.Options = { ...options, SkipToken: state.result.nextToken };
      }
      controller = new AbortController();
      releaseRequest = claimRequest(controller);
    } catch (error) {
      controller = undefined;
      errorMessage(error);
      return;
    }
    const active = controller;
    state.running = true;
    state.error = undefined;
    state.message = nextPage ? "Loading the next server page..." : "Executing resource query...";
    if (!nextPage) {
      state.result = undefined;
      state.executedQuery = structuredClone(query);
      state.executedName = state.name.trim() || "Untitled query";
      state.seenTokens = [];
      state.tablePage = 0;
    }
    finishLoading = beginLoading(state.message);
    syncControls();
    drawResults();
    try {
      const response = await executeResourceQuery(query, { accessToken, fetchImpl, signal: active.signal });
      if (disposed) return;
      active.signal.throwIfAborted();
      const page = resourceQueryPage(response);
      if (page.nextToken && state.seenTokens.includes(page.nextToken)) {
        if (state.result) {
          state.result.nextToken = undefined;
          state.result.incomplete = true;
        }
        throw new Error("Resource Query repeated a continuation token. Loaded rows were retained; pagination was stopped.");
      }
      if (page.nextToken) state.seenTokens.push(page.nextToken);
      const prior = nextPage ? state.result : undefined;
      state.result = { ...page, rows: [...(prior?.rows || []), ...page.rows], pages: [...(prior?.pages || []), page.raw] };
      if (!state.result.nextToken && state.result.totalRecords !== undefined &&
          state.result.rows.length + (state.executedQuery.Options?.Skip || 0) < state.result.totalRecords) {
        state.result.incomplete = true;
      }
      state.message = `${state.result.rows.length.toLocaleString()} row(s) loaded${state.result.nextToken ? "; more server pages available" : ""}.`;
      recordRequest(response);
    } catch (error) {
      if (!disposed) {
        state.message = error.name === "AbortError"
          ? `Query cancelled.${state.result ? " Already loaded rows were retained." : " No results were loaded."}` : "Query failed.";
        state.error = error.name === "AbortError" ? undefined : getApiErrorDescription(error);
        recordRequest(undefined, error);
      }
    } finally {
      if (controller === active) {
        controller = undefined;
        state.running = false;
        finishOperation();
        if (!disposed) {
          syncControls();
          drawResults();
        }
      }
    }
  }

  function onSubmit(event) {
    if (event.target.id === "rq-execute-form") {
      event.preventDefault();
      void execute();
    } else if (event.target.id === "rq-save-form") {
      event.preventDefault();
      if (!state.running) save();
    }
  }

  function onClick(event) {
    const button = event.target.closest("[data-rq-action]");
    if (!button || !root.contains(button)) return;
    const action = button.dataset.rqAction;
    if (action === "cancel") { controller?.abort(); return; }
    if (action === "toggle") {
      const id = button.dataset.node;
      if (state.expanded.has(id)) state.expanded.delete(id);
      else state.expanded.add(id);
      drawLibrary(id);
      return;
    }
    if (action === "table" || action === "json") {
      state.resultView = action;
      drawResults();
      button.focus();
      return;
    }
    if (action === "detail") { showDetail(state.result.rows[Number(button.dataset.row)]); return; }
    if (action === "previous" || action === "next") {
      state.tablePage += action === "next" ? 1 : -1;
      drawResults();
      return;
    }
    if (state.running) { state.message = "Cancel the active query before changing or saving it."; syncControls(); return; }
    if (action === "more") { void execute(true); return; }
    if (action === "new") {
      replaceDraft(JSON.stringify({ TableName: "PowerPlatformResources", Clauses: [], Options: { Top: 1000 } }, null, 2), "", "", undefined, undefined);
    } else if (action === "format") {
      remember();
      try {
        state.text = JSON.stringify(parseResourceQuery(state.text), null, 2);
        state.dirty = true;
        field("editor").value = state.text;
        state.error = undefined;
        state.message = "Query JSON formatted.";
        syncControls();
      } catch (error) { errorMessage(error); }
    } else if (action === "load") {
      const sample = RESOURCE_QUERY_SAMPLES.find((query) => query.id === button.dataset.sample);
      const saved = state.saved.find((query) => query.id === button.dataset.saved);
      if (sample) replaceDraft(JSON.stringify(sample.query, null, 2), sample.name, "", sample.id, undefined);
      else if (saved) replaceDraft(saved.text, saved.name, saved.folder, undefined, saved.id);
      else errorMessage(new Error("This query is no longer available. Reload the library."));
    } else if (action === "save-new") {
      save(true);
    } else if (action === "delete") {
      if (!confirm(`Delete "${state.name}" from this browser's saved queries?`)) return;
      try {
        deleteResourceQuery(getStorage(), state.savedId);
        state.savedId = undefined;
        state.dirty = true;
        state.error = undefined;
        state.message = "Saved query deleted. The current editor text was retained.";
        loadLibrary();
        drawLibrary();
        syncControls();
      } catch (error) { errorMessage(error, "Cannot delete query: "); }
    } else if (action === "reload-library") {
      loadLibrary();
      drawLibrary();
    } else if (action === "reset-library") {
      if (!confirm("Delete all saved queries from this browser? This cannot be undone.")) return;
      try {
        getStorage().removeItem(SAVED_QUERIES_KEY);
        state.savedId = undefined;
        state.dirty = true;
        loadLibrary();
        drawLibrary();
      } catch (error) { errorMessage(error, "Cannot reset the saved library: "); }
    }
  }

  function onInput(event) {
    if (!["rq-editor", "rq-query-name", "rq-folder"].includes(event.target.id)) return;
    remember();
    state.dirty = true;
    syncControls();
  }

  function onKeyDown(event) {
    const tab = event.target.closest('[role="tab"]');
    if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      state.resultView = event.key === "Home" ? "table" : event.key === "End" ? "json" : state.resultView === "table" ? "json" : "table";
      drawResults();
      field(`${state.resultView}-tab`).focus();
      return;
    }
    if (event.target.id === "rq-editor" && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (!state.running) void execute();
      return;
    }
    const item = event.target.closest('[role="treeitem"]');
    if (!item) return;
    const items = [...field("tree").querySelectorAll('[role="treeitem"]')].filter((node) => !node.disabled);
    const index = items.indexOf(item);
    let target;
    if (event.key === "ArrowDown") target = items[Math.min(index + 1, items.length - 1)];
    else if (event.key === "ArrowUp") target = items[Math.max(index - 1, 0)];
    else if (event.key === "Home") target = items[0];
    else if (event.key === "End") target = items.at(-1);
    else if (event.key === "ArrowRight") {
      if (item.getAttribute("aria-expanded") === "false") item.click();
      else if (items[index + 1]?.dataset.parent === item.dataset.node) target = items[index + 1];
    } else if (event.key === "ArrowLeft") {
      if (item.getAttribute("aria-expanded") === "true") item.click();
      else target = items.find((node) => node.dataset.node === item.dataset.parent);
    } else if (event.key === "Enter" || event.key === " ") item.click();
    else return;
    event.preventDefault();
    if (target) {
      items.forEach((node) => { node.tabIndex = node === target ? 0 : -1; });
      state.focusedNode = target.dataset.node;
      target.focus();
    }
  }

  function onStorage(event) {
    if (event.key !== SAVED_QUERIES_KEY && event.key !== null) return;
    loadLibrary();
    drawLibrary();
  }

  loadLibrary();
  state.running = false;
  draw();
  root.addEventListener("submit", onSubmit);
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("keydown", onKeyDown);
  eventTarget.addEventListener("storage", onStorage);
  return () => {
    remember();
    disposed = true;
    controller?.abort();
    controller = undefined;
    if (state.running) state.message = "Query cancelled because the workspace was closed. Already loaded rows were retained.";
    state.running = false;
    finishOperation();
    root.removeEventListener("submit", onSubmit);
    root.removeEventListener("click", onClick);
    root.removeEventListener("input", onInput);
    root.removeEventListener("keydown", onKeyDown);
    eventTarget.removeEventListener("storage", onStorage);
  };
}
