[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8080
)

$ErrorActionPreference = "Stop"
$appUrl = "http://localhost:$Port"
$configPath = Join-Path $PSScriptRoot "config.local.js"

if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "Create config.local.js from config.example.js and set tenantId and userPrincipalName."
}

$localConfig = Get-Content -LiteralPath $configPath -Raw
$tenantMatch = [regex]::Match($localConfig, 'tenantId\s*:\s*"(?<value>[^"]+)"')
$userMatch = [regex]::Match($localConfig, 'userPrincipalName\s*:\s*"(?<value>[^"]+)"')
if (-not $tenantMatch.Success -or -not $userMatch.Success) {
    throw "config.local.js must define tenantId and userPrincipalName using double-quoted values."
}

$tenantId = $tenantMatch.Groups["value"].Value
$expectedUser = $userMatch.Groups["value"].Value

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw "Azure CLI is required. Install it, then run this script again."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "Node.js and npm are required. Install them, then run this script again."
}

Write-Host "Signing in to tenant $tenantId as $expectedUser..." -ForegroundColor Cyan
& az login `
    --tenant $tenantId `
    --allow-no-subscriptions `
    --output none
if ($LASTEXITCODE -ne 0) {
    throw "Azure CLI sign-in failed."
}

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

Write-Host ""
Write-Host "Access token (paste into the web app; do not share it):" -ForegroundColor Yellow
Write-Output $accessToken
Write-Host ""

$serverReady = $false
try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $appUrl -TimeoutSec 2
    $serverReady = $response.StatusCode -eq 200
} catch {
    $serverReady = $false
}

if (-not $serverReady) {
    $previousPort = $env:PORT
    try {
        $env:PORT = $Port.ToString()
        $serverProcess = Start-Process `
            -FilePath "npm.cmd" `
            -ArgumentList "start" `
            -WorkingDirectory $PSScriptRoot `
            -PassThru
    } finally {
        $env:PORT = $previousPort
    }

    for ($attempt = 1; $attempt -le 20; $attempt += 1) {
        if ($serverProcess.HasExited) {
            throw "The reporting client server exited before it became ready."
        }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $appUrl -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                $serverReady = $true
                break
            }
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
}

if (-not $serverReady) {
    throw "The reporting client did not become available at $appUrl."
}

Write-Host "Opening $appUrl" -ForegroundColor Green
Start-Process $appUrl
