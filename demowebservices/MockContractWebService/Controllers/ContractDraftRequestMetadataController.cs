using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OData.Query;
using MockContractWebService.Models;
using MockContractWebService.Middleware;

namespace MockContractWebService.Controllers;

[ApiController]
[Route("b2bapi/v2")]
[ApiKeyAuth]
public class ContractDraftRequestMetadataController : ControllerBase
{
    private readonly ILogger<ContractDraftRequestMetadataController> _logger;

    public ContractDraftRequestMetadataController(ILogger<ContractDraftRequestMetadataController> logger)
    {
        _logger = logger;
    }

    [HttpGet("contract-draft-request/metadata")]
    [EnableQuery]
    public ActionResult<ContractFieldsResponse> GetMetadata()
    {
        _logger.LogInformation("Getting contract draft request metadata");

        var fields = new List<ContractField>
            {
                new ContractField
                {
                    ApiName = "gdpr2contractDraftRequest",
                    Label = "GDPR 28 Data Processor / Data Controller",
                    Type = "TEXT",
                    Description = "To render string or Data Processor or as Data Controller?",
                    ApiUrl = "b2bapi/v2/fields/options?entityName=contractDraftRequest&apiName=gdprDataProcessorDataController&offset=0&limit=10",
                    Value = "Data Processor",
                    Creatable = true,
                    Updatable = true,
                    Searchable = true,
                    Filterable = true,
                    Sortable = false,
                    ParentFields = new List<string>(),
                    ChildFields = new List<string>()
                },
                new ContractField
                {
                    ApiName = "termType",
                    Label = "Term Type",
                    Type = "TEXT",
                    Value = "Fixed Term – 36 Months",
                    Creatable = true,
                    Updatable = true,
                    Searchable = true,
                    Filterable = true,
                    Sortable = true,
                    ParentFields = new List<string>(),
                    ChildFields = new List<string>()
                },
                new ContractField
                {
                    ApiName = "effectiveDate",
                    Label = "Effective Date",
                    Type = "DATE",
                    Value = "01 January 2026",
                    Creatable = true,
                    Updatable = true,
                    Searchable = true,
                    Filterable = true,
                    Sortable = true,
                    ParentFields = new List<string>(),
                    ChildFields = new List<string>()
                },
                new ContractField
                {
                    ApiName = "outsourcing",
                    Label = "Outsourcing",
                    Type = "BOOLEAN",
                    Value = "Yes",
                    Creatable = true,
                    Updatable = true,
                    Searchable = true,
                    Filterable = true,
                    Sortable = false,
                    ParentFields = new List<string>(),
                    ChildFields = new List<string>()
                },
                new ContractField
                {
                    ApiName = "totalContractValue",
                    Label = "Total Contract Value (TCV)",
                    Type = "CURRENCY",
                    Value = "€2,500,000",
                    Creatable = true,
                    Updatable = true,
                    Searchable = true,
                    Filterable = true,
                    Sortable = true,
                    ParentFields = new List<string>(),
                    ChildFields = new List<string>()
                },
                new ContractField
                {
                    ApiName = "penaltiesAgreed",
                    Label = "Penalties Agreed",
                    Type = "BOOLEAN",
                    Value = "Yes",
                    Creatable = true,
                    Updatable = true,
                    Searchable = true,
                    Filterable = true,
                    Sortable = false,
                    ParentFields = new List<string>(),
                    ChildFields = new List<string>()
                },
                new ContractField
                {
                    ApiName = "penaltyRulesLocation",
                    Label = "Penalty Rules – Where To Find In Contract?",
                    Type = "TEXT",
                    Value = "Section 12.3 – Service Level Breach",
                    Creatable = true,
                    Updatable = true,
                    Searchable = true,
                    Filterable = false,
                    Sortable = false,
                    ParentFields = new List<string>(),
                    ChildFields = new List<string>()
                },
                new ContractField
                {
                    ApiName = "cloud",
                    Label = "Cloud",
                    Type = "TEXT",
                    Value = "Public Cloud – Multi-Region Deployment",
                    Creatable = true,
                    Updatable = true,
                    Searchable = true,
                    Filterable = true,
                    Sortable = false,
                    ParentFields = new List<string>(),
                    ChildFields = new List<string>()
                },
                new ContractField
                {
                    ApiName = "gdpr",
                    Label = "GDPR",
                    Type = "BOOLEAN",
                    Value = "Yes",
                    Creatable = true,
                    Updatable = true,
                    Searchable = true,
                    Filterable = true,
                    Sortable = false,
                    ParentFields = new List<string>(),
                    ChildFields = new List<string>()
                }
            };

        var response = new ContractFieldsResponse
        {
            Fields = fields
        };

        return Ok(response);
    }

    [HttpPost("contract-draft-request/metadata")]
    public ActionResult<ContractFieldsResponse> CreateMetadata([FromBody] ContractFieldValuesRequest request)
    {
        _logger.LogInformation("Creating contract draft request metadata with {Count} fields", request.Fields.Count);

        if (request.Fields == null || !request.Fields.Any())
        {
            return BadRequest(new { error = "At least one field is required" });
        }

        // Define the field schema/template
        var fieldDefinitions = new Dictionary<string, ContractField>
        {
            ["gdpr2contractDraftRequest"] = new ContractField
            {
                ApiName = "gdpr2contractDraftRequest",
                Label = "GDPR 28 Data Processor / Data Controller",
                Type = "TEXT",
                Description = "To render string or Data Processor or as Data Controller?",
                ApiUrl = "b2bapi/v2/fields/options?entityName=contractDraftRequest&apiName=gdprDataProcessorDataController&offset=0&limit=10",
                Creatable = true,
                Updatable = true,
                Searchable = true,
                Filterable = true,
                Sortable = false,
                ParentFields = new List<string>(),
                ChildFields = new List<string>()
            },
            ["termType"] = new ContractField
            {
                ApiName = "termType",
                Label = "Term Type",
                Type = "TEXT",
                Creatable = true,
                Updatable = true,
                Searchable = true,
                Filterable = true,
                Sortable = true,
                ParentFields = new List<string>(),
                ChildFields = new List<string>()
            },
            ["effectiveDate"] = new ContractField
            {
                ApiName = "effectiveDate",
                Label = "Effective Date",
                Type = "DATE",
                Creatable = true,
                Updatable = true,
                Searchable = true,
                Filterable = true,
                Sortable = true,
                ParentFields = new List<string>(),
                ChildFields = new List<string>()
            },
            ["outsourcing"] = new ContractField
            {
                ApiName = "outsourcing",
                Label = "Outsourcing",
                Type = "BOOLEAN",
                Creatable = true,
                Updatable = true,
                Searchable = true,
                Filterable = true,
                Sortable = false,
                ParentFields = new List<string>(),
                ChildFields = new List<string>()
            },
            ["totalContractValue"] = new ContractField
            {
                ApiName = "totalContractValue",
                Label = "Total Contract Value (TCV)",
                Type = "CURRENCY",
                Creatable = true,
                Updatable = true,
                Searchable = true,
                Filterable = true,
                Sortable = true,
                ParentFields = new List<string>(),
                ChildFields = new List<string>()
            },
            ["penaltiesAgreed"] = new ContractField
            {
                ApiName = "penaltiesAgreed",
                Label = "Penalties Agreed",
                Type = "BOOLEAN",
                Creatable = true,
                Updatable = true,
                Searchable = true,
                Filterable = true,
                Sortable = false,
                ParentFields = new List<string>(),
                ChildFields = new List<string>()
            },
            ["penaltyRulesLocation"] = new ContractField
            {
                ApiName = "penaltyRulesLocation",
                Label = "Penalty Rules – Where To Find In Contract?",
                Type = "TEXT",
                Creatable = true,
                Updatable = true,
                Searchable = true,
                Filterable = false,
                Sortable = false,
                ParentFields = new List<string>(),
                ChildFields = new List<string>()
            },
            ["cloud"] = new ContractField
            {
                ApiName = "cloud",
                Label = "Cloud",
                Type = "TEXT",
                Creatable = true,
                Updatable = true,
                Searchable = true,
                Filterable = true,
                Sortable = false,
                ParentFields = new List<string>(),
                ChildFields = new List<string>()
            },
            ["gdpr"] = new ContractField
            {
                ApiName = "gdpr",
                Label = "GDPR",
                Type = "BOOLEAN",
                Creatable = true,
                Updatable = true,
                Searchable = true,
                Filterable = true,
                Sortable = false,
                ParentFields = new List<string>(),
                ChildFields = new List<string>()
            }
        };

        var resultFields = new List<ContractField>();
        var errors = new List<string>();

        // Map incoming values to field definitions
        foreach (var fieldValue in request.Fields)
        {
            if (string.IsNullOrEmpty(fieldValue.ApiName))
            {
                errors.Add("ApiName is required for all fields");
                continue;
            }

            if (!fieldDefinitions.TryGetValue(fieldValue.ApiName, out var fieldDef))
            {
                errors.Add($"Unknown field: {fieldValue.ApiName}");
                continue;
            }

            // Create a new field with the value
            var field = new ContractField
            {
                ApiName = fieldDef.ApiName,
                Label = fieldDef.Label,
                Type = fieldDef.Type,
                Description = fieldDef.Description,
                ApiUrl = fieldDef.ApiUrl,
                Value = fieldValue.Value,
                Creatable = fieldDef.Creatable,
                Updatable = fieldDef.Updatable,
                Searchable = fieldDef.Searchable,
                Filterable = fieldDef.Filterable,
                Sortable = fieldDef.Sortable,
                ParentFields = fieldDef.ParentFields,
                ChildFields = fieldDef.ChildFields
            };

            resultFields.Add(field);
        }

        if (errors.Any())
        {
            return BadRequest(new { errors });
        }

        var response = new ContractFieldsResponse
        {
            Fields = resultFields
        };

        _logger.LogInformation("Successfully created {Count} metadata fields", resultFields.Count);

        return CreatedAtAction(nameof(GetMetadata), response);
    }
}
