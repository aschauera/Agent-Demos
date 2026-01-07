using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace MockContractWebService.Middleware;

[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public class ApiKeyAuthAttribute : Attribute, IAuthorizationFilter
{
    private const string ApiKeyHeaderName = "X-API-Key";

    public void OnAuthorization(AuthorizationFilterContext context)
    {
        if (!context.HttpContext.Request.Headers.TryGetValue(ApiKeyHeaderName, out var extractedApiKey))
        {
            context.Result = new UnauthorizedObjectResult(new { error = "API Key missing" });
            return;
        }

        var appSettings = context.HttpContext.RequestServices.GetRequiredService<IConfiguration>();
        var validApiKey = appSettings.GetValue<string>("ApiKey");

        if (string.IsNullOrEmpty(validApiKey) || !validApiKey.Equals(extractedApiKey))
        {
            context.Result = new UnauthorizedObjectResult(new { error = "Invalid API Key" });
            return;
        }
    }
}
