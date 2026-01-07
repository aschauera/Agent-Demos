namespace MockContractWebService.Models;

public class ContractDraftRequestResponse
{
    public List<ContractDraftRequest> Data { get; set; } = new();
    public int TotalCount { get; set; }
}

public class ContractDraftRequest
{
    public string Name { get; set; } = string.Empty;
    public int Id { get; set; }
}
