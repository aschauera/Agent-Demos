# Minimal Reporting API Client Implementation Plan

## Goal

Build a minimal local HTML client that requests a Copilot Studio
`BillingDetailsPerEnvironment` report, waits for asynchronous generation, downloads
the gzip-compressed CSV, and renders the rows in a browser table.

The API contract and prerequisites are documented in
`PP Reporting API Setup Guide.md`.

## Proposed user flow

1. Serve the demo on localhost and open it in a modern browser.
2. Obtain a delegated Power Automate access token with Azure CLI:

   ```powershell
   az login --tenant <tenant-id> --allow-no-subscriptions
   az account get-access-token `
     --resource "https://service.flow.microsoft.com/" `
     --tenant <tenant-id> `
     --query accessToken -o tsv
   ```

3. Enter the tenant ID, token, start date, end date, and granularity.
4. Submit the report request.
5. Watch the client wait and poll according to each `Retry-After` header.
6. When generation succeeds, download and decompress the CSV.
7. Review the report in a table or download the original `.csv.gz` file.

## Minimal architecture

Start with a dependency-free browser implementation:

- `index.html`: form, status panel, error panel, result table, and download action.
- `styles.css`: small responsive layout with clear loading and error states.
- `app.js`: validation, API calls, polling, cancellation, gzip decompression,
  CSV parsing, rendering, and object URL cleanup.
- `README.md`: prerequisites, Azure CLI token steps, local serving command,
  preview limitations, and troubleshooting.
- `tests/`: mocked API-flow tests if the chosen browser test tooling is already
  available in the repository.

Use the browser's `fetch`, `AbortController`, `Blob`, and
`DecompressionStream("gzip")` APIs. Keep the access token only in JavaScript
memory and clear it when the page unloads.

## Phase 0: Verify browser feasibility

Before building the complete UI:

1. Serve a tiny page from localhost.
2. Send an authenticated request to the preview endpoint using a valid delegated
   token.
3. Verify that the endpoint's CORS policy permits the localhost origin and
   exposes `Location` and `Retry-After` response headers.
4. Verify that `DecompressionStream("gzip")` works in the supported demo browser.

If CORS blocks direct requests or hides required headers, add a minimal localhost
proxy. The proxy must accept the token per request, keep it in memory only,
forward response status and required headers, and stream the gzip response
without persisting it. Do not use a browser-security workaround.

## Phase 1: Build the request form

Add fields for:

- Tenant ID.
- Delegated access token using a password-style input.
- Start and end dates.
- Granularity: `Daily` or `Summary`.

Validate before sending:

- Tenant ID is a GUID.
- All required values are present.
- End date is on or after start date.
- Dates use `yyyy-MM-dd`.

Default to a small date range and explain that one month or less is recommended.

## Phase 2: Implement the asynchronous API workflow

1. POST to:

   ```text
   https://preview.api.flow.microsoft.com/copilotstudio/tenants/{tenantId}/licensing/reports/BillingDetailsPerEnvironment?api-version=2016-11-01
   ```

2. Require `202 Accepted`, read `Location`, and wait for `Retry-After`.
3. Poll the exact operation URL from `Location`, adding the API version without
   duplicating an existing query parameter.
4. For `Running`, update the UI and repeat after the latest `Retry-After`.
5. For `Failed`, stop and show the returned error.
6. For `Succeeded`, follow the exact download URL in `Location`.
7. Support cancellation with one `AbortController` covering waits and requests.

Model the UI with explicit states: `ready`, `submitting`, `waiting`,
`downloading`, `complete`, `failed`, and `cancelled`.

## Phase 3: Download and display the report

1. Fetch the successful operation's download URL with the delegated token.
2. Retain the response as a `.csv.gz` `Blob` for user download.
3. Decompress the bytes explicitly because the API does not return a
   `Content-Encoding` header.
4. Parse CSV with support for quoted fields, escaped quotes, commas, and line
   breaks rather than splitting rows and columns naively.
5. Render the schema columns in a scrollable table.
6. Revoke replaced object URLs to avoid leaking browser memory.

## Phase 4: Error handling and guidance

Show actionable messages for:

- `400`: invalid request or date range.
- `401`: missing, expired, or wrong-audience token.
- `403`: wrong tenant membership or missing administrator role.
- `404`: unavailable report, tenant not enabled, or missing generated file.
- Network/CORS failures.
- Missing `Location` or invalid `Retry-After` headers.
- Unsupported operation statuses.
- Gzip decompression or CSV parsing failures.

Include the HTTP status plus the API's `error.code` and `error.message` when
available. Never log the authorization header or token.

## Phase 5: Validate

Use mocked responses to cover:

1. Invalid tenant ID and reversed date range.
2. Submit `202`, one or more `Running` polls, then `Succeeded`.
3. Updated `Retry-After` values during polling.
4. Terminal `Failed` status.
5. User cancellation while waiting and while fetching.
6. Structured `400`, `401`, `403`, and `404` errors.
7. Missing or malformed required headers.
8. A valid gzip CSV with quoted commas, quotes, and line breaks.
9. Malformed gzip and malformed CSV.

Then perform a live smoke test in a tenant that:

- Has a North America home geo.
- Has the preview API enabled.
- Uses a user with a supported administrator role.

## Definition of done

- The demo runs locally with documented setup steps.
- No secret or tenant data is committed or persisted by the app.
- A valid request follows server-provided URLs and polling intervals.
- The user can cancel a request without leaving background polling active.
- A successful report is shown in a table and downloadable as `.csv.gz`.
- API and client failures are clearly distinguishable and actionable.
- Mocked workflow tests pass, followed by a successful live smoke test.
