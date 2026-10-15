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

## Get a delegated token

Sign in using the tenant administrator:

```powershell
az login `
  --tenant "<tenant-id>" `
  --allow-no-subscriptions
```

Select the configured tenant administrator when the browser sign-in opens.

Request a delegated token for the Power Automate service:

```powershell
az account get-access-token `
  --resource "https://service.flow.microsoft.com/" `
  --tenant "<tenant-id>" `
  --query accessToken `
  --output tsv
```

Do not save the token to a file. Paste it into the password-style token field;
the client keeps it in browser memory only and clears the field when the page
unloads.

## Run

The startup script signs in to the configured tenant, prints the short-lived
Power Automate access token, starts the local server, waits for it to become
available, and opens the app:

```powershell
.\start-reporting-client.ps1
```

Treat the printed token like a password. Paste it into the app, do not share it,
and close the terminal when it is no longer needed.

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
respects each server-provided `Retry-After` interval.

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
