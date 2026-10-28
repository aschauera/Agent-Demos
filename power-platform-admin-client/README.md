# The Bridge

Managed Platform Command Center — a command bridge for your Power Platform tenant.

## Purpose and architecture

A dependency-free local web client for exploring and managing a Power Platform tenant through the [Power Platform API](https://learn.microsoft.com/en-us/rest/api/power-platform/). A minimal Node.js server serves a responsive dark HTML/CSS/JavaScript interface on loopback, with a tenant dashboard, an overview for each documented API section, and resource details. A generated Microsoft Learn catalog supplies operation methods, routes, versions, and reference links; the browser calls the API directly using delegated Microsoft Entra authorization-code authentication with PKCE. Access tokens and API results remain in memory, request paths are restricted to the selected API namespace, and all write/action requests require confirmation. Request bodies are entered manually using the linked operation schemas.

## Prerequisites: app registration setup

You need Node.js 20 or later, Windows PowerShell for nonblocking startup, and access to a Power Platform tenant. Your signed-in user must have the service-side permissions required by the operations you run.

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com/) in the target tenant.
2. Go to **Identity > Applications > App registrations > New registration**.
3. Enter a name, such as **The Bridge (Local)**, and choose **Accounts in this organizational directory only**.
4. Configure a **Single-page application (SPA)** redirect URI of `http://localhost:8080/`, then register the application. If the registration screen does not offer SPA, add it afterward under **Authentication > Add a platform > Single-page application**.
5. On **Overview**, copy the **Application (client) ID** and **Directory (tenant) ID**.
6. Under **API permissions > Add a permission > APIs my organization uses**, find **Power Platform API**. Its resource application ID is `8578e004-a5c6-46e7-913e-12f58912df43`.
7. Select **Delegated permissions** and add only those needed. For the initial environment overview, add `EnvironmentManagement.Environments.Read`. Consult the [permission reference](https://learn.microsoft.com/en-us/power-platform/admin/programmability-permission-reference) before enabling further operations.
8. Grant admin consent where required, using an appropriately authorized administrator.

Do **not** create a client secret or use application permissions for this client. It requests `https://api.powerplatform.com/.default`, which represents the delegated permissions configured on the registration; it does not grant every API permission. See Microsoft's [authentication guidance](https://learn.microsoft.com/en-us/power-platform/admin/programmability-authentication-v2).

## Installation and starting

From the repository root:

```powershell
cd .\power-platform-admin-client
npm start
```

No `npm install` or build step is required. On Windows, `npm start` starts an independent server, waits for its health check, and returns control to the terminal. It prints the URL, server PID, and the exact `Stop-Process -Id <PID>` command to stop it. An occupied port or startup failure produces an error.

Open <http://localhost:8080>. To use another port, for example when the reporting demo already uses 8080:

```powershell
npm start -- -Port 8081
```

Open <http://localhost:8081> and register `http://localhost:8081/` as an additional SPA redirect URI. Always use the same localhost origin and port for opening the client and registering its redirect URI.

For foreground debugging, use `npm run start:foreground` and stop with Ctrl+C. This command also works on other platforms with Node.js. Set the `PORT` environment variable to override its default port.

Optional maintenance commands:

```powershell
npm test
npm run refresh-catalog
```

Tests use mocked API responses and a local launcher smoke test, not tenant credentials. Catalog refresh requires PowerShell and internet access to Microsoft Learn.

## Connecting to a tenant

The bottom-left **Data source** selector chooses **Live tenant** (the default) or **Local Session with mock data**. The top-right badge uses the same session state: transparent green means a connected live tenant, while red means disconnected or local/offline mock mode. Expired live sessions are disconnected automatically.

Mock mode provides labeled sample environments, application packages/install status, and consumption CSV data without sending tenant API requests. Unsupported operations report that no sample is available, and mock management actions are read-only. Switching modes clears the access token and loaded data to avoid mixing sample and tenant results; reconnect after switching back to Live tenant. Cancel an active general API request before switching.

1. Open the running client and select **Connect tenant**.
2. Enter the **Directory (tenant) ID** and **Application (client) ID** from your app registration.
3. Select **Continue to sign in** and authenticate with a user in that tenant. Complete any consent or multifactor authentication required by your organization.
4. After returning to the client, the **Tenant overview** loads automatically (see below).
5. Open an API section, expand a resource group, and select **Use** beside an operation to prefill its documented method, route, and API version. Open its Microsoft Learn reference to check permissions and body schema, replace any `{parameter}` placeholders, and enter a JSON body when required.
6. Review the response table or JSON, select rows for details, and use **Load next page** where available. Counts describe loaded data, not necessarily tenant-wide totals.

For local development, use **Save locally** in the connection dialog, or check **Save tenant and app IDs in this browser** before signing in. Only those two public identifiers are saved to this localhost origin's browser storage, outside the filesystem and Git repository; tokens are never saved. Saved IDs prefill the dialog after reload. Use **Forget saved IDs** to remove them, or uncheck the option before signing in. Disconnecting retains opted-in IDs but clears the token and tenant data. Saving is opt-in; storage errors are displayed.

For optional file-based defaults, copy [config.example.js](./config.example.js) to `config.local.js` and set `tenantId` and `clientId`. The local file is git-ignored; never force-add it. Browser-saved IDs take precedence over file defaults. Use browser storage to keep saved IDs entirely outside the repository.

Select **Disconnect** to clear the local session. Tokens are held only in memory and disappear on reload; temporary PKCE state is removed after sign-in. API results and request bodies are not written to disk or browser storage. Test mutations in a non-production tenant first: confirmation does not replace service-side authorization or an assessment of an action's impact.

If sign-in fails, verify the SPA redirect URI and tenant/client IDs. For API access errors, check the operation's delegated permissions, admin consent, and your user's service-side role. The client surfaces HTTP status and API errors rather than substituting empty results.

All module pages show a sticky **Loading data** banner above the content while summaries, inventories, API operations, or consumption reports are loading. It tracks concurrent requests for the current page, marks the content busy for assistive technology, and respects reduced-motion preferences.

### Tenant overview

When connected, the dashboard shows tenant-wide aggregate charts instead of loaded-row counts. Totals are computed server-side by the [Power Platform inventory Resource Query API](https://learn.microsoft.com/en-us/power-platform/admin/power-platform-inventory-api) (`POST /resourcequery/resources/query`) using `summarize count()` queries, so the browser never pages through every resource:

- **KPI tiles**: total resources, environments, apps (canvas, model-driven, code, other), flows (cloud and agent flows), agents and connectors, from one count-by-`type` query. Each tile links to its module.
- **Top 10 environments by resources**: count by `properties.environmentId`, labeled with environment display names (the ID is in the tooltip).
- **Resources by region**: count by `location`.
- **Agents by harness**: reuses the Copilot Studio inventory summary (GitHub Copilot, Standard, Copilot Chat, Unknown).
- **Environments by type and managed state**: from the Environments API (`type` and `protectionLevel`). `Standard` protection is shown as **Managed** and `Basic` as **Not managed**; this mapping follows the Managed Environments convention.
- **Top 10 owners**: count by `properties.ownerId` (Entra object IDs, copyable).

Chart rows link to the related module. Each chart loads and fails independently; **Refresh overview** reloads everything and **Cancel** aborts. Add the delegated `ResourceQuery.Resources.Read` permission (plus `EnvironmentManagement.Environments.Read`). The inventory is eventually consistent (it can lag by up to about 20 minutes) and excludes classic V1 agents. Mock mode computes the same aggregates from a small sample inventory.

### App Management workspace

**App Management** combines the former **Power Apps** and **Power Pages** navigation modules. The workspace includes Power Apps, Power Pages, Code Apps, and Managed Apps category views, an environment-scoped inventory, loaded app/site counts, search, pagination, metadata details, and a fresh detail lookup. Each category retains the complete documented operation catalog and namespace-bound request runner: two Power Apps operations and 40 Power Pages operations in the current catalog. Power Pages actions such as create/delete, start/stop/restart, domains, certificates, WAF, and scans remain available with confirmation and manually entered documented bodies.

App Management occupies navigation position **02**. Entering a module while connected (or using mock mode) automatically loads its configured passive summary reads, cached for the current session with **Refresh summary** available. Dynamics solutions automatically loads its tenant package catalog. Modules without a safe configured tenant-wide read show an explicit limitation instead of running parameterized operations or trigger polls.

App Management discovers all accessible environments, follows environment/app/site pagination, and displays **Total apps**, **Canvas apps**, **Model driven apps**, **Code apps**, and **Power Pages** tiles. Total apps includes returned Power Apps plus websites. Scans are read-only and sequential; failed environments and missing permissions are shown, and partial totals are labeled. Type counts use explicit recognized type metadata only, never names or generic `Microsoft.PowerApps/apps` resource types. If records lack usable type metadata, type tiles show unavailable rather than misleading zeroes. Counts cover what the API exposes to the user, not inaccessible environments or app types omitted by the service. Disconnecting or switching data source cancels scans and clears cached summaries.

Code Apps and Managed Apps use the shared **Get AdminApps** and **Get AdminApp** operations. **Managed Apps is provisionally interpreted as model-driven apps**, not Azure Managed Applications. The current Power Platform REST reference does not document separate Code Apps/Managed Apps resources, lifecycle operations, or a reliable app-type/managed-solution discriminator. These category views therefore show the shared API results with an explicit coverage notice, not guessed type-filtered inventories or fabricated deploy/publish/delete endpoints. They do not claim that every model-driven or code app is returned. Use the complete response details to inspect the metadata the service actually returns.

Counts are per loaded environment/query, not tenant-wide totals. Power Apps uses its documented `nextLink` continuation; both namespaces keep their own validation, permissions, and result views. Existing Power Apps/Power Pages section links open the corresponding category in the combined workspace. **Dynamics solutions** remains a separate module. The documented Dynamics API section is labeled **Finance and Operations** in the client to reflect its scope; its API namespace remains `dynamics`.

### Copilot Studio overview

Opening **Copilot Studio** automatically loads agent inventory using the documented read-only `POST /resourcequery/resources/query` operation, filtering `PowerPlatformResources` to `microsoft.copilotstudio/agents`. Unlike management action POSTs, this fixed inventory query does not mutate resources or require confirmation. Add the delegated **ResourceQuery.Resources.Read** permission to the app registration and grant any required consent; the signed-in user also needs service-side inventory access. App-only authentication is not supported by this API.

Tiles show **Total agents**, **GitHub Copilot Harness**, **Standard**, **Copilot Chat**, and **Unknown harness** counts, with subtle color tints and only a title and count per tile. The GitHub Copilot money badge explains on hover or keyboard focus that these agents use Copilot Credits. Copilot Chat and unknown agents are not mislabeled as Standard. Classification uses `properties.harness` when present. For older records, it follows Microsoft's sample query: `isCLIAgent = true` identifies GitHub Copilot; `model = Microsoft 365 Copilot` or `createdIn = Microsoft 365 Copilot Agent Builder` identifies Copilot Chat; remaining records with usable classification metadata are Standard. Records with no classification metadata or an unrecognized explicit harness are Unknown. The inventory table shows each classification source and offers search and raw metadata details.

The client follows `skipToken` through all query pages, deduplicates agents, caches results for the current session, and offers **Refresh summary** and **Cancel summary**. Partial results, permission failures, invalid responses, and truncated results without continuation are explicitly marked. Switching data source or disconnecting clears inventory and cancels outstanding requests. Mock mode supplies sample agents only. Inventory is eventually consistent (changes typically appear within 20 minutes), excludes V1 agents, and reflects only inventory exposed to the signed-in user.

The inventory grid's **Details** button opens an agent-specific page with a business-friendly, read-only metadata form. Information is grouped into agent overview, ownership/activity, security/sharing, and channels/capabilities. Labels use readable names, booleans show Yes/No, dates use the browser's local time, and collections/nested properties appear as lists and labeled fields rather than JSON. Technical identifiers and additional fields remain in a collapsed section. A ribbon at the top groups every documented Copilot Studio operation into channels, agent management, and evaluations, with group headings above their buttons.

Ribbon buttons execute operations directly, without using the generic API form. Read operations with known IDs run immediately. A focused dialog collects missing IDs or operation-specific values (new owner's Entra user ID, connector consent bypass, evaluation run options); mutations require explicit **Confirm and run**. Channel manifests use the documented M365 channel with optional agent schema, and both download actions preserve ZIP bytes. Evaluation runs support a run name, optional Copilot Studio connection, and draft/published selection; advanced per-tool connection overrides remain available through the module overview's generic API runner. Results/errors appear below the metadata, loading is shown in the top banner, and **Cancel request** aborts the HTTP request. Cancellation does not undo submitted changes or stop a service-side evaluation run; HTTP success is not a claim that an evaluation completed. Mock management actions remain disabled and read-only. Metadata remains an eventually consistent inventory snapshot; refresh inventory to update it after changes. Agent detail links resolve against the current session inventory; after reload/sign-in the inventory is loaded again, and missing/inaccessible agents show an explicit notice with a return link.

Sources: [Inventory API and structured query clauses](https://learn.microsoft.com/en-us/power-platform/admin/inventory-api), [Agent inventory schema](https://learn.microsoft.com/en-us/microsoft-copilot-studio/admin-agent-inventory), and [Harness query examples](https://learn.microsoft.com/en-us/power-platform/admin/inventory-sample-queries#resource-lookups). The schema documents `properties.harness`, while the sample-query article still describes a derived fallback; the client supports both.

### Dynamics solutions dashboard

**Dynamics solutions** corresponds to the Dynamics apps area in PPAC. It uses all four documented App Management application-package operations, rather than displaying API catalog counts. The underlying API namespace remains `appmanagement`.

- **Load tenant packages** lists installable packages, with loaded-package and distinct-publisher totals.
- **Load environment packages** accepts an environment ID (not the organization ID), an optional install-state filter and language ID. The dashboard counts installed/template-installed packages, in-progress actions, and failed installs/uninstalls from this query's loaded rows.
- Search the loaded catalog or environment inventory, load subsequent pages, and select **Details** for complete package metadata, versions, visibility, and returned errors. Counts are explicitly partial until all pages of that query are loaded; the environment query may itself be filtered.
- Select **Prepare install**, verify the target environment ID, enter the package-specific `payloadValue` string, then **Review and install**. Confirmation is mandatory. The request uses the documented `{"payloadValue":"..."}` body, not inferred payload fields.
- **Check install status** retrieves an operation by environment and operation ID. Installation responses populate the operation ID when supplied by the service; it can also be entered manually. `202 Accepted` is not reported as completed. Status checks are manual and respect any returned `Retry-After`; failed/canceled operations and their errors remain visible.

Configure `AppManagement.ApplicationPackages.Read` and, only if installing, `AppManagement.ApplicationPackages.Install` as delegated permissions, with required consent and service-side access. This dashboard covers application packages, not an inventory of every canvas or model-driven app. Refresh the environment inventory after a completed install. Cancelling a request or navigating away stops local work, not an installation already accepted by the service. Loaded data remains in memory until disconnect/reload.

### Licensing consumption data

Under **Licensing**, select **Load consumption data** to request a Copilot Studio `BillingDetailsPerEnvironment` report. Enter the tenant ID, a separate delegated **Power Automate** access token (audience `https://service.flow.microsoft.com/`), date range, and Daily or Summary granularity. The admin console's Power Platform token cannot be used for this endpoint. Obtain the reporting token through an approved secure workflow without printing or persisting it.

This preview requires a tenant-enabled **North America home-geo** tenant and a tenant-member Global, Power Platform, or Dynamics 365 administrator. The feature directly reuses [the reporting demo's API implementation](../pp-reporting-api-demo/reporting-client.mjs), so keep that sibling folder when running the admin client. It follows server-provided operation/download URLs, respects `Retry-After`, supports cancellation, decompresses gzip CSV, displays up to 100 rows, and downloads the complete original `.csv.gz`. Tokens are cleared after each attempt; leaving the section or disconnecting cancels the request and clears its data. It does not read the reporting demo's local configuration or bootstrap token.

If browser CORS policy blocks the preview endpoint or hides `Location`/`Retry-After`, the client reports the error. This integration does not include a proxy; do not disable browser security.
