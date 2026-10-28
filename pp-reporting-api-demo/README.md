# Minimal Copilot Studio reporting client

This dependency-free localhost client requests the preview
`BillingDetailsPerEnvironment` report, follows the asynchronous operation,
decompresses the returned CSV, displays it, and keeps the original `.csv.gz`
available for download.

On desktop, request settings stay in a left sidebar while status and report
results occupy a wide reading pane on the right. On smaller screens, settings
stack above the reading pane.
The interface defaults to a dark portal-style theme with blue accents and subtle
chart-bar glows. Add `?scoutTheme=light` to the local URL for a light appearance.

As soon as the report is available, a vertical bar chart above the table shows
paired prepaid and pay-as-you-go consumed credits for every report row. Both
series share a scale. The x-axis uses regional date-only BilledDate categories,
with row-number fallbacks for Summary reports without dates. Hover over a group
for its row number and environment. Rows follow table order and are not
aggregated, so dates can repeat. Wide charts scroll horizontally.
Zero and negative adjustments are supported.
Billing dates in the table and chart use the browser's regional date-only
format without shifting the reported calendar day. Downloaded data is unchanged.
If a consumption column is missing or contains invalid numbers, the client
shows a chart-specific error and keeps the table and download available.

## Prerequisites

- Node.js 20 or later.
- Azure CLI.
- A tenant with a North America home geo and the preview API enabled.
- A user in that tenant with the Global Administrator, Power Platform
  Administrator, or Dynamics 365 Administrator role.

## Configure local defaults

Run `.\start-reporting-client.ps1` to configure local defaults interactively.
If `config.local.js` is absent or either setting is missing or blank, the
launcher prompts for the missing tenant ID and/or administrator user principal
name and saves them to `config.local.js`. Existing values are preserved.
Invalid prompt entries are rejected and requested again.

Alternatively, copy `config.example.js` to `config.local.js` and enter both
values using double-quoted strings. `config.local.js` is ignored by Git.
The launcher uses these settings for sign-in; the browser uses them as display
defaults and does not perform sign-in itself.

## Authentication

The recommended startup script signs in with Azure CLI and transfers the
delegated token directly to the localhost client using a one-time, in-memory
handoff. It does not print, log, or persist the token.

The browser client still accepts a manually supplied delegated token for
development scenarios. Use an approved secure acquisition workflow that does
not print, log, redirect, or persist the credential. The client keeps a pasted
token in browser memory only and clears the field when the page unloads.

## Run

The startup script signs in to the configured tenant, acquires the short-lived
Power Automate access token without printing it, starts a fresh local server,
waits for its demo-specific health response, transfers the token through a
one-time in-memory handoff, and opens the app:

```powershell
.\start-reporting-client.ps1
```

The launcher uses browser-based sign-in instead of the Windows account broker,
without changing your global Azure CLI configuration. If sign-in stalls, cancel
with Ctrl+C and use device-code sign-in:

```powershell
.\start-reporting-client.ps1 -UseDeviceCode
```

Follow the URL and code displayed by Azure CLI and sign in with the configured
administrator account. Device-code sign-in must be permitted by your tenant's
Conditional Access policies.

To use a different local port:

```powershell
.\start-reporting-client.ps1 -Port 8081
```

To start only the local server:

```powershell
npm start
```

Open <http://localhost:8080>, paste the token, select a small date range, and
request the report. Report generation can take several minutes. The client
respects each server-provided `Retry-After` interval and displays a countdown
progress bar showing the time remaining until the next status check.

Run the mocked workflow tests with:

```powershell
npm test
```

## Troubleshooting

- **Windows sign-in dialog hangs**: Cancel the previous launcher with Ctrl+C
  and rerun the updated script, which uses browser sign-in. If that also stalls,
  use `-UseDeviceCode` as described above. The script waits for authentication
  before starting the server.
- **401**: Get a fresh token and confirm its audience is
  `https://service.flow.microsoft.com/`.
- **403**: Confirm the user belongs to the target tenant and has a supported
  administrator role.
- **404**: Confirm the preview API is enabled and the tenant home geo is North
  America.
- **Network/CORS error**: The preview endpoint may not permit direct requests
  from `localhost` or may not expose `Location` and `Retry-After`. Do not disable
  browser security. A same-origin localhost proxy is required if the endpoint's
  CORS policy blocks this client.
- **Decompression error**: Confirm the download is the generated `.csv.gz` file
  and use a current Edge, Chrome, or Firefox release with
  `DecompressionStream` support.
- **Port already in use**: Stop the existing server or choose another port with
  `.\start-reporting-client.ps1 -Port 8081`. The launcher refuses to open an
  unrelated service or reuse a server that cannot receive the one-time token.
