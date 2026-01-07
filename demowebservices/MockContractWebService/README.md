# Mock Contract Web Service

A .NET 8 Web API that returns contract draft request data for testing purposes.

## Local Development

Run the application locally:

```powershell
dotnet run
```

The API will be available at:
- HTTP: http://localhost:5000
- HTTPS: https://localhost:5001
- Swagger UI: https://localhost:5001/swagger

## API Endpoint

**GET** `/b2bapi/v2/fields/options`

### Query Parameters:
- `entityName` - Entity name (default: "contractDraftRequest")
- `apiName` - API name (default: "gdpr2")
- `dataProcessor` - Data processor type (default: "DataController")
- `offset` - Pagination offset (default: 0)
- `limit` - Items per page (default: 10)

### Example Request:
```
GET https://localhost:5001/b2bapi/v2/fields/options?entityName=contractDraftRequest&apiName=gdpr2&dataProcessor=DataController&offset=0&limit=10
```

### Example Response:
```json
{
  "data": [
    {
      "name": "Data Controller",
      "id": 2599
    },
    {
      "name": "Data Processor",
      "id": 2598
    },
    {
      "name": "Evaluation Required",
      "id": 5730
    }
  ],
  "totalCount": 3
}
```

## Deployment to Azure

### Option 1: Azure App Service

1. Create an App Service:
```powershell
az webapp create --name <your-app-name> --resource-group <your-rg> --plan <your-plan> --runtime "DOTNET|8.0"
```

2. Deploy:
```powershell
dotnet publish -c Release
az webapp deployment source config-zip --resource-group <your-rg> --name <your-app-name> --src ./bin/Release/net8.0/publish.zip
```

### Option 2: Azure Container Apps

1. Build and push container:
```powershell
az acr build --registry <your-acr> --image mockcontractapi:latest .
```

2. Deploy to Container Apps:
```powershell
az containerapp create --name mockcontractapi --resource-group <your-rg> --environment <your-env> --image <your-acr>.azurecr.io/mockcontractapi:latest --target-port 8080 --ingress external
```

## Technologies

- .NET 8
- ASP.NET Core Web API
- Swagger/OpenAPI
