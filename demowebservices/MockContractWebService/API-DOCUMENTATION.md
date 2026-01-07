# Mock Contract Web Service API Documentation

A REST API service for retrieving contract draft request metadata and field options with support for OData queries and API key authentication.

## Base URL

```
https://aschi-custom-contract-api.redmeadow-373e98f8.westus.azurecontainerapps.io
```

## Authentication

All API endpoints require authentication using an API key in the request header.

**Header:**
```
X-API-Key: your-api-key-here
```

**Error Responses:**

- `401 Unauthorized` - Missing or invalid API key
  ```json
  { "error": "API Key missing" }
  { "error": "Invalid API Key" }
  ```

---

## Endpoints

### 1. Get Contract Draft Request Metadata

Retrieves metadata for all contract fields including field definitions, types, values, and capabilities.

**Endpoint:** `GET /b2bapi/v2/contract-draft-request/metadata`

**Headers:**
- `X-API-Key` (required)
- `Accept: application/json`

**Response:** Array of contract field metadata

**Example Request:**
```http
GET /b2bapi/v2/contract-draft-request/metadata
X-API-Key: your-api-key
Accept: application/json
```

**Example Response:**
```json
[
  {
    "apiName": "gdpr2contractDraftRequest",
    "label": "GDPR 28 Data Processor / Data Controller",
    "type": "TEXT",
    "description": "To render string or Data Processor or as Data Controller?",
    "apiUrl": "b2bapi/v2/fields/options?entityName=contractDraftRequest&apiName=gdprDataProcessorDataController&offset=0&limit=10",
    "value": "Data Processor",
    "creatable": true,
    "updatable": true,
    "searchable": true,
    "filterable": true,
    "sortable": false,
    "parentFields": [],
    "childFields": []
  },
  {
    "apiName": "termType",
    "label": "Term Type",
    "type": "TEXT",
    "value": "Fixed Term – 36 Months",
    "creatable": true,
    "updatable": true,
    "searchable": true,
    "filterable": true,
    "sortable": true,
    "parentFields": [],
    "childFields": []
  }
]
```

**Available Fields:**
- GDPR 28 Data Processor / Data Controller
- Term Type
- Effective Date
- Outsourcing
- Total Contract Value (TCV)
- Penalties Agreed
- Penalty Rules – Where To Find In Contract?
- Cloud
- GDPR

---

### 2. Get Contract Draft Request Options

Retrieves available options for contract draft request fields with pagination support.

**Endpoint:** `GET /b2bapi/v2/fields/options`

**Headers:**
- `X-API-Key` (required)
- `Accept: application/json`

**Query Parameters:**
- `entityName` (optional) - Entity name (default: "contractDraftRequest")
- `apiName` (optional) - API name (default: "gdprDataController")
- `offset` (optional) - Pagination offset (default: 0)
- `limit` (optional) - Items per page (default: 10)

**Example Request:**
```http
GET /b2bapi/v2/fields/options?entityName=contractDraftRequest&apiName=gdpr2&offset=0&limit=10
X-API-Key: your-api-key
Accept: application/json
```

**Example Response:**
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

---

## OData Query Support

The metadata endpoint (`/b2bapi/v2/contract-draft-request/metadata`) supports OData query options for advanced filtering, sorting, and selection.

### Supported OData Operators

- **$filter** - Filter results based on conditions
- **$select** - Select specific properties
- **$orderby** - Sort results
- **$count** - Include total count
- **$top** - Limit number of results (max: 100)

### Filter Operators

- `eq` - Equal to
- `ne` - Not equal to
- `gt` - Greater than
- `lt` - Less than
- `ge` - Greater than or equal to
- `le` - Less than or equal to
- `and` - Logical AND
- `or` - Logical OR

### OData Examples

#### Filter fields with apiUrl
```http
GET /b2bapi/v2/contract-draft-request/metadata?$filter=apiUrl ne null
X-API-Key: your-api-key
```

#### Filter by field type
```http
GET /b2bapi/v2/contract-draft-request/metadata?$filter=Type eq 'BOOLEAN'
X-API-Key: your-api-key
```

#### Filter by multiple conditions
```http
GET /b2bapi/v2/contract-draft-request/metadata?$filter=Filterable eq true and Type eq 'TEXT'
X-API-Key: your-api-key
```

#### Select specific properties
```http
GET /b2bapi/v2/contract-draft-request/metadata?$select=ApiName,Label,Value
X-API-Key: your-api-key
```

#### Sort by label
```http
GET /b2bapi/v2/contract-draft-request/metadata?$orderby=Label
X-API-Key: your-api-key
```

#### Sort descending
```http
GET /b2bapi/v2/contract-draft-request/metadata?$orderby=Label desc
X-API-Key: your-api-key
```

#### Limit results
```http
GET /b2bapi/v2/contract-draft-request/metadata?$top=5
X-API-Key: your-api-key
```

#### Get count
```http
GET /b2bapi/v2/contract-draft-request/metadata?$count=true
X-API-Key: your-api-key
```

#### Combine multiple options
```http
GET /b2bapi/v2/contract-draft-request/metadata?$filter=Type eq 'TEXT'&$orderby=Label&$select=ApiName,Label,Value&$top=10
X-API-Key: your-api-key
```

---

## Field Types

The API returns the following field types:

- **TEXT** - String/text values
- **DATE** - Date values
- **BOOLEAN** - True/false values (Yes/No)
- **CURRENCY** - Monetary values

---

## Field Properties

Each field in the metadata response includes:

| Property | Type | Description |
|----------|------|-------------|
| `apiName` | string | Unique identifier for the field |
| `label` | string | Human-readable field name |
| `type` | string | Data type (TEXT, DATE, BOOLEAN, CURRENCY) |
| `description` | string | Field description (optional) |
| `apiUrl` | string | Related API endpoint for field options (optional) |
| `value` | string | Current/default field value |
| `creatable` | boolean | Whether the field can be created |
| `updatable` | boolean | Whether the field can be updated |
| `searchable` | boolean | Whether the field is searchable |
| `filterable` | boolean | Whether the field can be filtered |
| `sortable` | boolean | Whether the field can be sorted |
| `parentFields` | array | Related parent fields |
| `childFields` | array | Related child fields |

---

## Response Codes

| Code | Description |
|------|-------------|
| `200 OK` | Request successful |
| `401 Unauthorized` | Missing or invalid API key |
| `400 Bad Request` | Invalid query parameters |
| `500 Internal Server Error` | Server error |

---

## Rate Limiting

Currently, no rate limiting is enforced. This may change in future versions.

---

## CORS Support

The API supports Cross-Origin Resource Sharing (CORS) and accepts requests from any origin.

---

## Swagger/OpenAPI Documentation

Interactive API documentation is available at:

**Development:**
```
https://localhost:5001/swagger
```

**Production:**
```
https://aschi-custom-contract-api.redmeadow-373e98f8.westus.azurecontainerapps.io/swagger
```

---

## Example Client Code

### JavaScript/TypeScript

```javascript
const API_KEY = 'your-api-key';
const BASE_URL = 'https://aschi-custom-contract-api.redmeadow-373e98f8.westus.azurecontainerapps.io';

// Get all metadata
async function getMetadata() {
  const response = await fetch(`${BASE_URL}/b2bapi/v2/contract-draft-request/metadata`, {
    headers: {
      'X-API-Key': API_KEY,
      'Accept': 'application/json'
    }
  });
  return await response.json();
}

// Get metadata with filter
async function getFilteredMetadata() {
  const response = await fetch(
    `${BASE_URL}/b2bapi/v2/contract-draft-request/metadata?$filter=Type eq 'BOOLEAN'`,
    {
      headers: {
        'X-API-Key': API_KEY,
        'Accept': 'application/json'
      }
    }
  );
  return await response.json();
}

// Get field options
async function getFieldOptions(entityName = 'contractDraftRequest') {
  const response = await fetch(
    `${BASE_URL}/b2bapi/v2/fields/options?entityName=${entityName}&offset=0&limit=10`,
    {
      headers: {
        'X-API-Key': API_KEY,
        'Accept': 'application/json'
      }
    }
  );
  return await response.json();
}
```

### Python

```python
import requests

API_KEY = 'your-api-key'
BASE_URL = 'https://aschi-custom-contract-api.redmeadow-373e98f8.westus.azurecontainerapps.io'

headers = {
    'X-API-Key': API_KEY,
    'Accept': 'application/json'
}

# Get all metadata
response = requests.get(
    f'{BASE_URL}/b2bapi/v2/contract-draft-request/metadata',
    headers=headers
)
metadata = response.json()

# Get metadata with filter
response = requests.get(
    f'{BASE_URL}/b2bapi/v2/contract-draft-request/metadata',
    headers=headers,
    params={'$filter': 'Type eq \'BOOLEAN\''}
)
filtered_metadata = response.json()

# Get field options
response = requests.get(
    f'{BASE_URL}/b2bapi/v2/fields/options',
    headers=headers,
    params={
        'entityName': 'contractDraftRequest',
        'offset': 0,
        'limit': 10
    }
)
options = response.json()
```

### C#

```csharp
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;

public class ContractApiClient
{
    private readonly HttpClient _httpClient;
    private const string ApiKey = "your-api-key";
    private const string BaseUrl = "https://aschi-custom-contract-api.redmeadow-373e98f8.westus.azurecontainerapps.io";

    public ContractApiClient()
    {
        _httpClient = new HttpClient();
        _httpClient.DefaultRequestHeaders.Add("X-API-Key", ApiKey);
        _httpClient.DefaultRequestHeaders.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/json"));
    }

    public async Task<string> GetMetadataAsync()
    {
        var response = await _httpClient.GetAsync(
            $"{BaseUrl}/b2bapi/v2/contract-draft-request/metadata");
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync();
    }

    public async Task<string> GetFieldOptionsAsync(string entityName = "contractDraftRequest")
    {
        var response = await _httpClient.GetAsync(
            $"{BaseUrl}/b2bapi/v2/fields/options?entityName={entityName}&offset=0&limit=10");
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync();
    }
}
```

---

## Support

For issues or questions, please contact the API administrator.

## Version

API Version: 1.0  
Last Updated: December 10, 2025
