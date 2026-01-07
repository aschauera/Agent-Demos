# API Key Authentication

All API endpoints now require an API key to be passed in the `X-API-Key` header.

## Configuration

The API key is configured in `appsettings.json`:

```json
{
  "ApiKey": "<key>"
}
```

For production deployments, set this as an environment variable in Azure Container Apps:

```powershell
az containerapp update `
  --name aschi-custom-contract-api `
  --resource-group rg-WebApps `
  --set-env-vars "ApiKey=your-secure-api-key-here"
```

## Usage

Include the API key in the request header:

```http
GET /b2bapi/v2/contract-draft-request/metadata
X-API-Key: mock-contract-api-key-12345
```

## Error Responses

**Missing API Key:**
```json
{
  "error": "API Key missing"
}
```
Status: 401 Unauthorized

**Invalid API Key:**
```json
{
  "error": "Invalid API Key"
}
```
Status: 401 Unauthorized

## Testing with Swagger

When using Swagger UI, click the "Authorize" button and enter the API key value.

## Default API Key

- **Development:** `<key>`
- **Production:** Set via environment variable for security
