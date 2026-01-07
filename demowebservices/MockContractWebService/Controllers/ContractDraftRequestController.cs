using Microsoft.AspNetCore.Mvc;
using MockContractWebService.Models;
using MockContractWebService.Middleware;

namespace MockContractWebService.Controllers;

[ApiController]
[Route("b2bapi/v2/fields/options")]
[ApiKeyAuth]
public class ContractDraftRequestController : ControllerBase
{
    private readonly ILogger<ContractDraftRequestController> _logger;

    public ContractDraftRequestController(ILogger<ContractDraftRequestController> logger)
    {
        _logger = logger;
    }

    [HttpGet]
    public ActionResult<ContractDraftRequestResponse> GetContractDraftRequests(
        [FromQuery] string entityName = "contractDraftRequest",
        [FromQuery] string apiName = "gdprDataController",
        [FromQuery] int offset = 0,
        [FromQuery] int limit = 10)
    {
        _logger.LogInformation("Getting contract draft requests with entityName={EntityName}, apiName={ApiName}, offset={Offset}, limit={Limit}",
            entityName, apiName, offset, limit);

        // Return the mock data matching the screenshot
        var response = new ContractDraftRequestResponse
        {
            Data = new List<ContractDraftRequest>
            {
                new ContractDraftRequest { Name = "Data Controller", Id = 2599 },
                new ContractDraftRequest { Name = "Data Processor", Id = 2598 },
                new ContractDraftRequest { Name = "Evaluation Required", Id = 5730 }
            },
            TotalCount = 3
        };

        return Ok(response);
    }
}
