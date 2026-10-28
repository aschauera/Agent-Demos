[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8080,
    [switch]$UseDeviceCode
)

$ErrorActionPreference = "Stop"
$appUrl = "http://localhost:$Port"
$configPath = Join-Path $PSScriptRoot "config.local.js"

$localConfig = if (Test-Path -LiteralPath $configPath -PathType Leaf) {
    Get-Content -LiteralPath $configPath -Raw
} else {
    "window.REPORTING_CLIENT_CONFIG = {`n};`n"
}
if ($localConfig -notmatch 'window\.REPORTING_CLIENT_CONFIG\s*=\s*\{') {
    throw "config.local.js must assign window.REPORTING_CLIENT_CONFIG to an object."
}

$settings = @(
    @{ Name = "tenantId"; Prompt = "Enter your Microsoft Entra tenant ID" }
    @{ Name = "userPrincipalName"; Prompt = "Enter your administrator user principal name" }
)
$configChanged = $false
$values = @{}
foreach ($setting in $settings) {
    $pattern = '\b' + $setting.Name + '\s*:\s*"(?<value>[^"]*)"'
    $match = [regex]::Match($localConfig, $pattern)
    $value = $match.Groups["value"].Value.Trim()
    if ([string]::IsNullOrWhiteSpace($value)) {
        if (-not $match.Success -and $localConfig -match ('\b' + $setting.Name + '\s*:')) {
            throw "config.local.js must define $($setting.Name) using a double-quoted value."
        }
        do {
            $value = (Read-Host $setting.Prompt).Trim()
            $valid = if ($setting.Name -eq "tenantId") {
                $value -match '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
            } else {
                $value -match '^[^@\s]+@[^@\s]+$'
            }
            if (-not $valid) {
                Write-Warning "Enter a valid $($setting.Name)."
            }
        } until ($valid)

        $property = "$($setting.Name): $(ConvertTo-Json -InputObject $value -Compress)"
        if ($match.Success) {
            $localConfig = $localConfig.Remove($match.Index, $match.Length).Insert($match.Index, $property)
        } else {
            $assignment = [regex]::Match($localConfig, 'window\.REPORTING_CLIENT_CONFIG\s*=\s*\{')
            $localConfig = $localConfig.Insert(
                $assignment.Index + $assignment.Length,
                "`n  $property,"
            )
        }
        $configChanged = $true
    }
    $values[$setting.Name] = $value
}
if ($configChanged) {
    Set-Content -LiteralPath $configPath -Value $localConfig -Encoding UTF8
    Write-Host "Saved local defaults to config.local.js."
}
$tenantId = $values["tenantId"]
$expectedUser = $values["userPrincipalName"]

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw "Azure CLI is required. Install it, then run this script again."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is required. Install it, then run this script again."
}

Write-Host "Signing in to tenant $tenantId as $expectedUser..." -ForegroundColor Cyan
$loginArguments = @(
    "login", "--tenant", $tenantId,
    "--allow-no-subscriptions", "--output", "none"
)
if ($UseDeviceCode) {
    $loginArguments += "--use-device-code"
    Write-Host "Open the URL displayed by Azure CLI and enter its device code. Waiting for sign-in..."
} else {
    Write-Host "Complete sign-in in your browser. If it stalls, press Ctrl+C and rerun with -UseDeviceCode."
}

$previousBrokerSetting = $env:AZURE_CORE_ENABLE_BROKER_ON_WINDOWS
try {
    $env:AZURE_CORE_ENABLE_BROKER_ON_WINDOWS = "false"
    & az @loginArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI sign-in failed. Try running this script with -UseDeviceCode."
    }
} finally {
    $env:AZURE_CORE_ENABLE_BROKER_ON_WINDOWS = $previousBrokerSetting
}

Write-Host "Sign-in completed. Acquiring the Power Automate access token..." -ForegroundColor Cyan
$accessToken = & az account get-access-token `
    --resource "https://service.flow.microsoft.com/" `
    --tenant $tenantId `
    --query accessToken `
    --output tsv
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($accessToken)) {
    throw "Azure CLI did not return a Power Automate access token."
}

$tokenParts = $accessToken.Split(".")
if ($tokenParts.Count -ne 3) {
    throw "Azure CLI returned an access token in an unexpected format."
}
$payload = $tokenParts[1].Replace("-", "+").Replace("_", "/")
$payload = $payload.PadRight($payload.Length + ((4 - ($payload.Length % 4)) % 4), "=")
$claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) |
    ConvertFrom-Json
$signedInUser = @(
    $claims.preferred_username
    $claims.upn
    $claims.unique_name
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1

if ($signedInUser -and $signedInUser -ne $expectedUser) {
    throw "Signed in as $signedInUser, but this demo requires $expectedUser. Run 'az logout' and try again."
}

function Get-ReportingClientHealth {
    param([string]$HealthUrl)

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 2
    } catch {
        if ($null -ne $_.Exception.Response) {
            return "Conflict"
        }
        return "Unavailable"
    }

    if (
        $response.StatusCode -eq 200 -and
        $response.Headers["X-Reporting-Client"] -eq "pp-reporting-api-demo"
    ) {
        return "Ready"
    }
    return "Conflict"
}

$healthUrl = "$appUrl/health"
$initialHealth = Get-ReportingClientHealth -HealthUrl $healthUrl
if ($initialHealth -eq "Ready") {
    throw "The reporting client is already running on port $Port. Stop it or choose another port."
}
if ($initialHealth -eq "Conflict") {
    throw "Port $Port is in use by another application. Choose another port with -Port."
}

$bootstrapNonce = [Guid]::NewGuid().ToString("N")
$previousPort = $env:PORT
$previousToken = $env:REPORTING_ACCESS_TOKEN
$previousNonce = $env:REPORTING_BOOTSTRAP_NONCE
try {
    $env:PORT = $Port.ToString()
    $env:REPORTING_ACCESS_TOKEN = $accessToken
    $env:REPORTING_BOOTSTRAP_NONCE = $bootstrapNonce
    $serverProcess = Start-Process `
        -FilePath "node" `
        -ArgumentList "server.mjs" `
        -WorkingDirectory $PSScriptRoot `
        -PassThru
} finally {
    $env:PORT = $previousPort
    $env:REPORTING_ACCESS_TOKEN = $previousToken
    $env:REPORTING_BOOTSTRAP_NONCE = $previousNonce
    $accessToken = $null
}

for ($attempt = 1; $attempt -le 20; $attempt += 1) {
    if ($serverProcess.HasExited) {
        throw "The reporting client server exited before it became ready."
    }

    $health = Get-ReportingClientHealth -HealthUrl $healthUrl
    if ($health -eq "Ready") {
        break
    }
    if ($health -eq "Conflict") {
        throw "Port $Port was claimed by another application while the server was starting."
    }
    Start-Sleep -Milliseconds 250
}

if ($health -ne "Ready") {
    Stop-Process -Id $serverProcess.Id
    throw "The reporting client did not become available at $appUrl."
}

Write-Host "Opening $appUrl" -ForegroundColor Green
Start-Process "$appUrl/#bootstrap=$bootstrapNonce"
$bootstrapNonce = $null
