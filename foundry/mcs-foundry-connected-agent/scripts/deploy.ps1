[CmdletBinding()]
param(
    [string]$EnvironmentName = "hr-systems-expert-dev",
    [string]$ProjectName = "hr-systems-expert",
    [string]$ResourceGroupName,
    [string]$ModelDeploymentName = "gpt-5.4-mini",
    [string]$Location = "northcentralus",
    [string]$SubscriptionId,
    [switch]$SkipProvision,
    [switch]$SmokeTest
)

$ErrorActionPreference = "Stop"
$env:AZURE_DEV_USER_AGENT = "microsoft_foundry_skill"

if (-not $ResourceGroupName) {
    $ResourceGroupName = "rg-$EnvironmentName"
}

function Invoke-Azd {
    param(
        [Parameter(Mandatory)]
        [string[]]$Arguments
    )

    & azd @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "azd command failed: azd $($Arguments -join ' ')"
    }
}

if (-not (Get-Command azd -ErrorAction SilentlyContinue)) {
    throw "Azure Developer CLI is required. Install it from https://aka.ms/install-azd."
}

& azd auth login --check-status *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Azure Developer CLI is not authenticated. Run 'azd auth login' and rerun this script."
}

if (-not $SubscriptionId) {
    if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
        throw "Provide -SubscriptionId or install Azure CLI."
    }

    $SubscriptionId = (& az account show --query id --output tsv).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $SubscriptionId) {
        throw "Unable to resolve an Azure subscription. Run 'az login' or provide -SubscriptionId."
    }
}

& azd env select $EnvironmentName --no-prompt *> $null
if ($LASTEXITCODE -ne 0) {
    Invoke-Azd -Arguments @(
        "env", "new", $EnvironmentName,
        "--subscription", $SubscriptionId,
        "--location", $Location,
        "--no-prompt"
    )
}

Invoke-Azd -Arguments @("env", "set", "AZURE_SUBSCRIPTION_ID", $SubscriptionId, "--environment", $EnvironmentName)
Invoke-Azd -Arguments @("env", "set", "AZURE_LOCATION", $Location, "--environment", $EnvironmentName)
Invoke-Azd -Arguments @("env", "set", "AZURE_RESOURCE_GROUP", $ResourceGroupName, "--environment", $EnvironmentName)
Invoke-Azd -Arguments @("env", "set", "AZURE_AI_PROJECT_NAME", $ProjectName, "--environment", $EnvironmentName)
Invoke-Azd -Arguments @("env", "set", "AZURE_AI_MODEL_DEPLOYMENT_NAME", $ModelDeploymentName, "--environment", $EnvironmentName)

if (-not $SkipProvision) {
    Write-Host "Provisioning isolated resource group '$ResourceGroupName'."
    Invoke-Azd -Arguments @("provision", "--no-state", "--no-prompt", "--environment", $EnvironmentName)
}

Invoke-Azd -Arguments @("deploy", "hr-systems-expert", "--no-prompt", "--environment", $EnvironmentName)
Invoke-Azd -Arguments @("ai", "agent", "show", "--output", "json", "--environment", $EnvironmentName)

if ($SmokeTest) {
    Invoke-Azd -Arguments @(
        "ai", "agent", "invoke",
        "What is the salary range for a Power Platform Architect?",
        "--protocol", "responses",
        "--environment", $EnvironmentName
    )
}

Invoke-Azd -Arguments @(
    "ai", "agent", "eval", "generate",
    "--gen-instruction",
    "Demo HR systems expert that retrieves mocked job role, salary range, and job-leveling data.",
    "--no-wait",
    "--no-prompt",
    "--environment", $EnvironmentName
)

Write-Host "Deployment completed. Run 'azd ai agent eval run --environment $EnvironmentName' when evaluation generation is ready."
