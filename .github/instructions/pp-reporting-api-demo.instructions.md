---
description: "Use when creating or modifying the local HTML reporting client demo under pp-reporting-api-demo."
applyTo: "pp-reporting-api-demo/**"
---

# Power Platform reporting API demo

This folder contains a minimal local HTML client demo for the Copilot Studio licensing reports API. Treat `PP Reporting API Setup Guide.md` as the source of truth for the preview API contract.

## Demo scope

- Keep the implementation dependency-light and understandable from the browser code.
- Serve the client from localhost rather than opening it with `file://`.
- Support `BillingDetailsPerEnvironment` with `Daily` and `Summary` granularities.
- Let the user provide the tenant ID, date range, granularity, and a delegated access token obtained outside the app.
- Keep access tokens in memory only. Never log, persist, cache, or commit tokens or tenant-specific report data.
- Favor a focused demo and straightforward setup over production-oriented abstractions.

## API contract

- Use `https://preview.api.flow.microsoft.com/copilotstudio/tenants/{tenantId}/licensing/reports`.
- Add `api-version=2016-11-01` to every request.
- Use a delegated user token for the `https://service.flow.microsoft.com/` audience. App-only tokens and Power Platform API audience tokens are unsupported.
- Validate tenant IDs as GUIDs and require `endDate` to be on or after `startDate`.
- Submit the request, follow the response `Location` header, respect `Retry-After`, and poll until `Succeeded` or `Failed`.
- Treat `Failed` as terminal and require a new submission.
- Follow the successful poll response's `Location` header to download the report; do not construct operation or file URLs.
- Handle the download as a gzip-compressed CSV without relying on a `Content-Encoding` header.
- Surface HTTP status, API error code, and API error message to the user. Do not turn failures into success-shaped results.

## Preview limitations

- Clearly state that the endpoint is preview-only, tenant-enabled, and currently limited to tenants with a North America home geo.
- Clearly state that the signed-in user must belong to the tenant and hold a supported administrator role.
- If direct browser requests are blocked by CORS, use a minimal localhost proxy rather than weakening browser security or embedding credentials.

## UX and validation

- Show the current phase: ready, submitting, waiting, downloading, complete, failed, or cancelled.
- Display the server-provided wait interval and provide a way to cancel polling.
- Parse and render the decompressed CSV in a readable table and provide a download action for the original `.csv.gz` file.
- Test validation, running-to-success, terminal failure, cancellation, API error rendering, and gzip/CSV handling with mocked responses before using a live tenant.
