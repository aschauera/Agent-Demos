[CmdletBinding()]
param(
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
$scriptDirectory = if ($PSScriptRoot) {
    $PSScriptRoot
} else {
    Split-Path -Parent $MyInvocation.MyCommand.Path
}
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $scriptDirectory "api-catalog.generated.js"
}
$sourceUrl = "https://learn.microsoft.com/en-us/rest/api/toc.json"
$docsRoot = "https://learn.microsoft.com/en-us/rest/api/"
$permissionMap = @{
    analytics = @(
        "Analytics.AdvisorActions.Execute",
        "Analytics.AdvisorRecommendations.Read"
    )
    appmanagement = @(
        "AppManagement.ApplicationPackages.Install",
        "AppManagement.ApplicationPackages.Read"
    )
    authorization = @(
        "Authorization.RoleAssignments.Read",
        "Authorization.RoleAssignments.Write"
    )
    connectivity = @(
        "Connectivity.Connectors.Read",
        "Connectivity.Connections.Read"
    )
    copilotstudio = @(
        "CopilotStudio.AdminActions.Invoke",
        "CopilotStudio.Copilots.Invoke"
    )
    environmentmanagement = @(
        "EnvironmentManagement.Environments.Read",
        "EnvironmentManagement.Groups.Read",
        "EnvironmentManagement.Groups.ReadWrite",
        "EnvironmentManagement.Settings.Read",
        "EnvironmentManagement.Settings.ReadWrite"
    )
    governance = @(
        "Governance.CrossTenantConnectionReports.Read",
        "Governance.CrossTenantConnectionReports.ReadWrite"
    )
    licensing = @(
        "Licensing.Allocations.Read",
        "Licensing.Allocations.ReadWrite",
        "Licensing.BillingPolicies.Read",
        "Licensing.BillingPolicies.ReadWrite",
        "Licensing.IsvContracts.Read",
        "Licensing.IsvContracts.ReadWrite"
    )
    powerapps = @(
        "PowerApps.Apps.Play",
        "PowerApps.Apps.Read"
    )
    powerautomate = @(
        "PowerAutomate.Flows.Read",
        "PowerAutomate.Flows.Write"
    )
    powerpages = @(
        "PowerPages.Websites.Read",
        "PowerPages.Websites.Write"
    )
    resourcequery = @(
        "ResourceQuery.Resources.Read"
    )
}
$allPermissions = @(
    "AiFlows.Ai.Execute",
    "AiFlows.Ai.Read",
    "AiFlows.Ai.Write",
    "AiFlows.Connections.Read",
    "AiFlows.Runs.Execute",
    "AiFlows.Runs.Read",
    "AiFlows.Runs.Write",
    "AiFlows.Workflows.Execute",
    "AiFlows.Workflows.Read",
    "AiFlows.Workflows.Write",
    "AiTools.Prompt.Invoke",
    "AiTools.Prompt.Read",
    "AiTools.Prompt.Write",
    "Analytics.AdvisorActions.Execute",
    "Analytics.AdvisorRecommendations.Read",
    "AppManagement.ApplicationPackages.Install",
    "AppManagement.ApplicationPackages.Read",
    "Authorization.RoleAssignments.Read",
    "Authorization.RoleAssignments.Write",
    "Connectivity.Connectors.Read",
    "Connectivity.Connections.Read",
    "CopilotFlows.ChatAssistant.Execute",
    "CopilotFlows.CloudFlows.ChatAssistant",
    "CopilotFlows.Workflows.Generate",
    "CopilotGovernance.Features.Execute",
    "CopilotGovernance.Features.Read",
    "CopilotGovernance.Settings.Read",
    "CopilotGovernance.Settings.Write",
    "CopilotStudio.AdminActions.Invoke",
    "CopilotStudio.Copilots.Invoke",
    "EnvironmentManagement.Environments.Read",
    "EnvironmentManagement.Groups.Read",
    "EnvironmentManagement.Groups.ReadWrite",
    "EnvironmentManagement.Settings.Read",
    "EnvironmentManagement.Settings.ReadWrite",
    "Governance.CrossTenantConnectionReports.Read",
    "Governance.CrossTenantConnectionReports.ReadWrite",
    "Licensing.Allocations.Read",
    "Licensing.Allocations.ReadWrite",
    "Licensing.BillingPolicies.Read",
    "Licensing.BillingPolicies.ReadWrite",
    "Licensing.IsvContracts.Read",
    "Licensing.IsvContracts.ReadWrite",
    "PowerApps.Apps.Play",
    "PowerApps.Apps.Read",
    "PowerAutomate.Flows.Read",
    "PowerAutomate.Flows.Write",
    "PowerPages.Websites.Read",
    "PowerPages.Websites.Write",
    "ResourceQuery.Resources.Read",
    "Security.Recommendations.Read"
)

function ConvertTo-Slug {
    param([Parameter(Mandatory)][string]$Value)
    return (($Value.ToLowerInvariant() -replace "[^a-z0-9]+", "-").Trim("-"))
}

function Get-OperationMetadata {
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$Namespace
    )

    try {
        $html = (Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 30).Content
        $decodedHtml = [System.Net.WebUtility]::HtmlDecode($html)
        $match = [regex]::Match(
            $decodedHtml,
            '(?s)(GET|POST|PUT|PATCH|DELETE)\s+(https://api\.powerplatform\.com[^\s<"]+)'
        )
        if (-not $match.Success) {
            return [ordered]@{
                method = $null
                path = $null
                apiVersion = $null
                metadataError = "No documented Power Platform request URL was found."
            }
        }

        $method = $match.Groups[1].Value
        $apiUrl = $match.Groups[2].Value
        $versionMatch = [regex]::Match($apiUrl, '[?&]api-version=([^&]+)')
        $apiVersion = if ($versionMatch.Success) {
            $versionMatch.Groups[1].Value
        } else {
            $versionInPage = [regex]::Match($decodedHtml, '(?is)API Version.{0,300}?(\d{4}-\d{2}-\d{2})')
            if ($versionInPage.Success) { $versionInPage.Groups[1].Value } else { $null }
        }
        $prefix = "https://api.powerplatform.com/$Namespace"
        if (-not $apiVersion -or -not $apiUrl.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
            return [ordered]@{
                method = $method
                path = $null
                apiVersion = $apiVersion
                metadataError = "The API route or version did not match the documented namespace."
            }
        }

        $route = $apiUrl.Substring($prefix.Length)
        $route = [regex]::Replace($route, '(?i)([?&])api-version=[^&]+', '$1')
        $route = $route -replace '\?&', '?' -replace '[?&]$', ''
        if ($route -and -not $route.StartsWith("/")) {
            return [ordered]@{
                method = $method
                path = $null
                apiVersion = $apiVersion
                metadataError = "The extracted route was not rooted in its API namespace."
            }
        }

        [ordered]@{
            method = $method
            path = $route.TrimStart("/")
            apiVersion = $apiVersion
            metadataError = $null
        }
    } catch {
        [ordered]@{
            method = $null
            path = $null
            apiVersion = $null
            metadataError = $_.Exception.Message
        }
    }
}

$toc = Invoke-RestMethod -Uri $sourceUrl -TimeoutSec 30
$apiRoot = @($toc.items | Where-Object { $_.toc_title -eq "Power Platform API" }) | Select-Object -First 1
if (-not $apiRoot) {
    throw "The Microsoft Learn TOC did not contain the Power Platform API root."
}

$sections = foreach ($section in @($apiRoot.children | Where-Object { $_.toc_title -ne "Overview" })) {
    $firstReference = @(
        foreach ($resource in @($section.children)) {
            foreach ($entry in @($resource.children)) {
                if ($entry.href) {
                    $entry
                    break
                }
            }
        }
    ) | Select-Object -First 1
    if (-not $firstReference) {
        throw "Could not determine the namespace for API section '$($section.toc_title)'."
    }
    $namespace = ($firstReference.href -split "/")[1]

    $resourceGroups = foreach ($resource in @($section.children)) {
        $entries = @($resource.children)
        $overview = $entries | Where-Object { $_.toc_title -eq "Overview" } | Select-Object -First 1
        $operations = @(
            $entries |
                Where-Object { $_.toc_title -ne "Overview" -and $_.href } |
                ForEach-Object {
                    $operationUrl = "$docsRoot$($_.href)"
                    $metadata = Get-OperationMetadata -Url $operationUrl -Namespace $namespace
                    [ordered]@{
                        id = ConvertTo-Slug $_.toc_title
                        title = $_.toc_title
                        docsUrl = $operationUrl
                        method = $metadata.method
                        path = $metadata.path
                        apiVersion = $metadata.apiVersion
                        metadataError = $metadata.metadataError
                    }
                    Start-Sleep -Milliseconds 75
                }
        )
        [ordered]@{
            id = ConvertTo-Slug $resource.toc_title
            title = $resource.toc_title
            docsUrl = if ($overview) { "$docsRoot$($overview.href)" } else { $null }
            operations = $operations
        }
    }

    $operationCount = ($resourceGroups | ForEach-Object { $_.operations.Count } | Measure-Object -Sum).Sum

    [ordered]@{
        id = ConvertTo-Slug $section.toc_title
        title = $section.toc_title
        namespace = $namespace
        description = "$($section.toc_title) resources and operations documented in the Power Platform API reference."
        docsUrl = "$docsRoot$($firstReference.href)"
        permissions = @($permissionMap[$namespace])
        resourceGroups = @($resourceGroups)
        resourceGroupCount = @($resourceGroups).Count
        operationCount = [int]$operationCount
    }
}

$catalog = [ordered]@{
    sourceUrl = "https://learn.microsoft.com/en-us/rest/api/power-platform/"
    tocUrl = $sourceUrl
    generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    allPermissions = $allPermissions
    sections = @($sections)
}
$json = $catalog | ConvertTo-Json -Depth 20 -Compress
$output = @"
export const API_ROOT = "https://api.powerplatform.com";
export const API_REFERENCE = "$($catalog.sourceUrl)";
export const PERMISSIONS_REFERENCE = "https://learn.microsoft.com/en-us/power-platform/admin/programmability-permission-reference";
export const ALL_PERMISSIONS = $($catalog.allPermissions | ConvertTo-Json -Compress);
export const API_SECTIONS = $($catalog.sections | ConvertTo-Json -Depth 20 -Compress);
export const CATALOG_GENERATED_AT = "$($catalog.generatedAt)";
export const ENVIRONMENTS_LIST = {
  method: "GET",
  path: "environments",
  apiVersion: "2024-10-01",
  permission: "EnvironmentManagement.Environments.Read",
  docsUrl: "https://learn.microsoft.com/en-us/rest/api/power-platform/environmentmanagement/environments/list-environments-for-user"
};
export function getSectionById(id) {
  return API_SECTIONS.find((section) => section.id === id);
}
export function getNamespacePath(section) {
  return section.namespace;
}
"@
Set-Content -LiteralPath $OutputPath -Value $output -Encoding utf8
$operationTotal = (@($sections | ForEach-Object { $_.operationCount } | Measure-Object -Sum).Sum)
$unresolved = @(
    $sections |
        ForEach-Object { $_.resourceGroups } |
        ForEach-Object { $_.operations } |
        Where-Object { $_.metadataError }
)
Write-Host "Wrote $($sections.Count) API sections and $operationTotal operations to $OutputPath"
if ($unresolved.Count) {
    foreach ($operation in $unresolved) {
        Write-Warning "Could not resolve '$($operation.title)': $($operation.metadataError)"
    }
}
