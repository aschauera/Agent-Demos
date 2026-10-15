# Copilot Studio Licensing Reports API

Download Copilot Studio licensing and consumption reports for your tenant.

Report generation can take several minutes, so the API uses the **asynchronous request-reply** pattern:

1. **Submit** a report request. You get back `202 Accepted` and an operation URL.
2. **Poll** the operation URL until the status is `Succeeded` or `Failed`.
3. **Download** the generated file from the URL returned when the operation succeeds.

```
Client                                       Power Automate API
  | POST  .../reports/{report}                       |
  |------------------------------------------------->|
  |<------ 202 Accepted, Location: .../operations/{operationId}, Retry-After
  |                                                  |
  | GET   .../reports/{report}/operations/{operationId}   (repeat after Retry-After)
  |------------------------------------------------->|
  |<------ 200 {"status":"Running"}, Retry-After     |
  |<------ 200 {"status":"Succeeded","fileName":...}, Location: .../files/{fileName}
  |                                                  |
  | GET   .../reports/{report}/files/{fileName}      |
  |------------------------------------------------->|
  |<------ 200 application/gzip (CSV)                |
```

---

## Before you begin

### Base URL

Call the Power Automate API directly:

```
https://preview.api.flow.microsoft.com/copilotstudio/tenants/{tenantId}/licensing/reports
```

Include the query parameter `?api-version=2016-11-01` on every request.

> For the initial release, the API is only available on the Power Automate **preview** endpoint (`preview.api.flow.microsoft.com`). Calling it through the Power Platform API (`api.powerplatform.com`) isn't supported.

> **Supported tenants:** The preview endpoint only works for tenants whose home geo is **North America (NAM)**. Support for tenants in other geos is coming soon.

### Authentication

Send a **delegated (user) Microsoft Entra ID access token** whose audience is the Power Automate service:

| Setting | Value |
|---|---|
| Resource / audience | `https://service.flow.microsoft.com/` |
| Scope (MSAL / v2.0 endpoint) | `https://service.flow.microsoft.com//.default` |

#### Get a token with the Azure CLI

1. Sign in to your tenant. The `--allow-no-subscriptions` flag lets admins without an Azure subscription sign in.

   ```powershell
   az login --tenant {tenantId} --allow-no-subscriptions
   ```

2. Get an access token for the Power Automate service:

   ```powershell
   az account get-access-token `
     --resource "https://service.flow.microsoft.com/" `
     --tenant {tenantId} `
     --query accessToken -o tsv
   ```

3. Send the token in the `Authorization` header of every request:

   ```
   Authorization: Bearer <access-token>
   ```

Tokens expire after about an hour. If you get `401 Unauthorized`, run step 2 again.

App-only (service principal) tokens aren't supported. Tokens issued for `https://api.powerplatform.com` are rejected with `401 Unauthorized`.

### Required permissions

The signed-in user must:

- Belong to the tenant in the `{tenantId}` path. Cross-tenant requests are rejected.
- Hold at least one of these Microsoft Entra roles in that tenant:
  - Global Administrator
  - Power Platform Administrator
  - Dynamics 365 Administrator

Otherwise, every endpoint returns `403 Forbidden`.

### Availability

The API is enabled per tenant. If it isn't enabled for your tenant, every endpoint returns `404 Not Found`.

---

## Available reports

The `{report}` path value isn't case-sensitive.

| `{report}` | Description |
|---|---|
| `BillingDetailsPerEnvironment` | Copilot credit entitlement and consumption (prepaid and pay-as-you-go), broken down by environment, entitlement and billing policy. |

The report supports two granularities:

| `granularity` | Description |
|---|---|
| `Daily` (default) | One row per day in the requested range. |
| `Summary` | Values summed over the whole requested range. |

The output columns are listed under [Report file schemas](#report-file-schemas).

---

## 1. Submit a report request

```
POST /copilotstudio/tenants/{tenantId}/licensing/reports/{report}?api-version=2016-11-01
Content-Type: application/json
```

### Path parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `tenantId` | GUID | Yes | Your Microsoft Entra tenant ID. |
| `report` | string | Yes | A report name from [Available reports](#available-reports). |

### Request body

| Property | Type | Required | Description |
|---|---|---|---|
| `startDate` | date (`yyyy-MM-dd`) | Yes | First day of the range (inclusive, UTC). Any time part is ignored. |
| `endDate` | date (`yyyy-MM-dd`) | Yes | Last day of the range (inclusive, UTC). Must be on or after `startDate`. |
| `granularity` | string | No | `Daily` or `Summary`. Defaults to `Daily`. |

```json
{
  "startDate": "2026-09-01",
  "endDate": "2026-09-30",
  "granularity": "Daily"
}
```

### Response: `202 Accepted`

No response body.

| Header | Description |
|---|---|
| `Location` | Absolute URL of the operation to poll (step 2). |
| `Retry-After` | Seconds to wait before the first poll. |

```http
HTTP/1.1 202 Accepted
Location: https://preview.api.flow.microsoft.com/copilotstudio/tenants/{tenantId}/licensing/reports/BillingDetailsPerEnvironment/operations/{operationId}
Retry-After: 300
```

### Errors

| Status | `error.code` | Cause |
|---|---|---|
| 400 | `InvalidRequestContent` | `tenantId` isn't a GUID, the body is missing, `startDate` or `endDate` is missing, or `endDate` is before `startDate`. |
| 401 | — | The access token is missing, expired, or has the wrong audience. |
| 403 | `InsufficientPermissions` | The caller isn't in the tenant or doesn't hold a required admin role. |
| 404 | `ResourceNotFound` | The report name is unknown, or the API isn't enabled for the tenant. |

---

## 2. Poll the operation status

Call the URL from the `Location` header returned in step 1.

```
GET /copilotstudio/tenants/{tenantId}/licensing/reports/{report}/operations/{operationId}?api-version=2016-11-01
```

### Path parameters

| Name | Type | Description |
|---|---|---|
| `tenantId` | GUID | Your tenant ID. |
| `report` | string | The report name used in step 1. |
| `operationId` | string | The operation ID from the step 1 `Location` header. |

### Response: `200 OK`

This endpoint returns `200 OK` for every state, including failures. Check the `status` property to see where the operation is.

| Property | Type | Description |
|---|---|---|
| `status` | string | `Running`, `Succeeded` or `Failed`. |
| `fileName` | string | Only when `status` is `Succeeded`. The name of the generated file. |
| `error` | string | Only when `status` is `Failed`. A readable error message. |

| `status` | Headers | What to do next |
|---|---|---|
| `Running` | `Retry-After` | Wait for the `Retry-After` interval, then poll again. |
| `Succeeded` | `Location` (download URL) | Download the file (step 3). |
| `Failed` | — | Stop polling and submit a new request (step 1). |

**Running**

```http
HTTP/1.1 200 OK
Retry-After: 300

{ "status": "Running" }
```

**Succeeded**

```http
HTTP/1.1 200 OK
Location: https://preview.api.flow.microsoft.com/copilotstudio/tenants/{tenantId}/licensing/reports/BillingDetailsPerEnvironment/files/billingdetailsperenvironment_{tenantId}_2026-09-01_2026-09-30_daily.csv.gz

{
  "status": "Succeeded",
  "fileName": "billingdetailsperenvironment_{tenantId}_2026-09-01_2026-09-30_daily.csv.gz"
}
```

**Failed**

```http
HTTP/1.1 200 OK

{
  "status": "Failed",
  "error": "The report could not be generated. Please try again later."
}
```

### Errors

| Status | `error.code` | Cause |
|---|---|---|
| 400 | `InvalidRequestContent` | `tenantId` isn't a GUID. |
| 403 | `InsufficientPermissions` | The caller isn't in the tenant or doesn't hold a required admin role. |
| 404 | — | The API isn't enabled for the tenant. |

---

## 3. Download the report

Call the URL from the `Location` header returned when the status is `Succeeded`.

```
GET /copilotstudio/tenants/{tenantId}/licensing/reports/{report}/files/{fileName}?api-version=2016-11-01
```

### Path parameters

| Name | Type | Description |
|---|---|---|
| `tenantId` | GUID | Your tenant ID. |
| `report` | string | The report name used in step 1. |
| `fileName` | string | The `fileName` value returned by the poll endpoint. |

### Response: `200 OK`

| Header | Value |
|---|---|
| `Content-Type` | `application/gzip` |
| `Content-Disposition` | `attachment; filename=<fileName>` |

The body is a **gzip-compressed CSV file** (`.csv.gz`). It's sent as-is, without a `Content-Encoding` header, so your HTTP client won't decompress it automatically. Save the file and decompress it yourself.

File name format:

```
{report lowercase}_{tenantId}_{startDate}_{endDate}_{granularity lowercase}.csv.gz
```

### Errors

| Status | `error.code` | Cause |
|---|---|---|
| 400 | `InvalidRequestContent` | `tenantId` isn't a GUID. |
| 403 | `InsufficientPermissions` | The caller isn't in the tenant or doesn't hold a required admin role. |
| 404 | — | The file doesn't exist, doesn't belong to the tenant or report, or the API isn't enabled for the tenant. |

---

## Error response format

Error responses use this format:

```json
{
  "error": {
    "code": "InvalidRequestContent",
    "message": "The request content was invalid and could not be deserialized: ''endDate' must be on or after 'startDate'.'."
  }
}
```

---

## Report file schemas

### `BillingDetailsPerEnvironment`

| Column | Type | Daily | Summary | Description |
|---|---|:-:|:-:|---|
| `TenantId` | GUID | ✓ | ✓ | Tenant ID. |
| `EnvironmentId` | string | ✓ | ✓ | Power Platform environment ID. |
| `EnvironmentName` | string | ✓ | ✓ | Environment display name. |
| `EntitlementId` | string | ✓ | ✓ | Entitlement (capacity) ID. |
| `BillingPolicyId` | string | ✓ | ✓ | Pay-as-you-go billing policy ID, if any. |
| `EntitledQuantity` | decimal | ✓ | | Credits entitled on that day. |
| `PrepaidConsumedQuantity` | decimal | ✓ | ✓ (sum) | Credits consumed from prepaid capacity. |
| `PayGoConsumedQuantity` | decimal | ✓ | ✓ (sum) | Credits consumed through pay-as-you-go. |
| `BilledDate` | date | ✓ | | Billing date (UTC). |

---

## End-to-end example (PowerShell)

```powershell
$tenantId   = "<tenant-guid>"
$apiVersion = "2016-11-01"

# Sign in once: az login --tenant $tenantId --allow-no-subscriptions
$token      = az account get-access-token --resource "https://service.flow.microsoft.com/" --tenant $tenantId --query accessToken -o tsv
$headers    = @{ Authorization = "Bearer $token" }
$base       = "https://preview.api.flow.microsoft.com/copilotstudio/tenants/$tenantId/licensing/reports"

# 1. Submit
$body  = @{ startDate = "2026-09-01"; endDate = "2026-09-30"; granularity = "Daily" } | ConvertTo-Json
$start = Invoke-WebRequest -Method Post -Uri "$base/BillingDetailsPerEnvironment?api-version=$apiVersion" `
           -Headers $headers -ContentType "application/json" -Body $body
$operationUrl = $start.Headers.Location
$wait         = [int]$start.Headers.'Retry-After'

# 2. Poll
do {
    Start-Sleep -Seconds $wait
    $poll   = Invoke-WebRequest -Uri "$($operationUrl)?api-version=$apiVersion" -Headers $headers
    $status = $poll.Content | ConvertFrom-Json
    if ($poll.Headers.'Retry-After') { $wait = [int]$poll.Headers.'Retry-After' }
} while ($status.status -eq "Running")

if ($status.status -eq "Failed") { throw $status.error }

# 3. Download, then decompress
$downloadUrl = $poll.Headers.Location
Invoke-WebRequest -Uri "$($downloadUrl)?api-version=$apiVersion" -Headers $headers -OutFile $status.fileName
```

---

## Best practices

- **Respect `Retry-After`.** Reports are built on demand and usually take minutes, not seconds. Polling faster doesn't speed them up.
- **Follow the `Location` headers** instead of building URLs yourself. The operation and file URL formats may change.
- **Treat a `Failed` operation as final.** Submit a new request rather than polling the failed operation again.
- **Keep date ranges small** (for example, one month at a time) so reports finish faster.
- **Decompress the file yourself.** The body is gzip and no `Content-Encoding` header is sent.
