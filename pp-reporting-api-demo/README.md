# Minimal Copilot Studio reporting client

This dependency-free localhost client requests the preview
`BillingDetailsPerEnvironment` report, follows the asynchronous operation,
decompresses the returned CSV, displays it, and keeps the original `.csv.gz`
available for download.

## Prerequisites

- Node.js 20 or later.
- Azure CLI.
- A tenant with a North America home geo and the preview API enabled.
- A user in that tenant with the Global Administrator, Power Platform
  Administrator, or Dynamics 365 Administrator role.

## Configure local defaults

Copy `config.example.js` to `config.local.js` and enter the tenant ID and user
principal name. `config.local.js` is ignored by Git. These values are display
defaults only; the app does not perform sign-in.

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
