namespace MockContractWebService.Models;

public class ContractDraftRequestMetadata
{
    public string? ApiName { get; set; }
    public string? Label { get; set; }
    public string? Type { get; set; }
    public bool Creatable { get; set; }
    public bool Updatable { get; set; }
    public bool Searchable { get; set; }
    public bool Filterable { get; set; }
    public bool Sortable { get; set; }
    public List<string> ParentFields { get; set; } = new();
    public List<string> ChildFields { get; set; } = new();
}

public class ContractDraftRequestMetadataGroup
{
    public string? ApiName { get; set; }
    public string? Label { get; set; }
    public string? Type { get; set; }
    public string? Description { get; set; }
    public string? ApiUrl { get; set; }
    public bool Creatable { get; set; }
    public bool Updatable { get; set; }
    public bool Searchable { get; set; }
    public bool Filterable { get; set; }
    public bool Sortable { get; set; }
    public List<string> ParentFields { get; set; } = new();
    public List<string> ChildFields { get; set; } = new();
}

public class ContractFieldsResponse
{
    public List<ContractField> Fields { get; set; } = new();
}

public class ContractField
{
    public string? ApiName { get; set; }
    public string? Label { get; set; }
    public string? Type { get; set; }
    public string? Description { get; set; }
    public string? ApiUrl { get; set; }
    public string? Value { get; set; }
    public bool Creatable { get; set; }
    public bool Updatable { get; set; }
    public bool Searchable { get; set; }
    public bool Filterable { get; set; }
    public bool Sortable { get; set; }
    public List<string> ParentFields { get; set; } = new();
    public List<string> ChildFields { get; set; } = new();
}

public class ContractFieldValue
{
    public string ApiName { get; set; } = string.Empty;
    public string? Value { get; set; }
}

public class ContractFieldValuesRequest
{
    public List<ContractFieldValue> Fields { get; set; } = new();
}
