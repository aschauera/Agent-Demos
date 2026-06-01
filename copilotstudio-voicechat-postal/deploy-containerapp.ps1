#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Build and deploy the Copilot Studio voice webchat to Azure Container Apps.

.DESCRIPTION
    Fully interactive — for EVERY Azure resource (Subscription, Location,
    Resource Group, Container Registry, Container Apps Environment, Container
    App, Azure AI Speech) you can list existing instances, pick one, or choose
    [NEW] to create / name it on the fly. Secrets (Direct Line + Speech key)
    are prompted as SecureStrings and wired in as Container App `--secrets`.

.EXAMPLE
    .\deploy-containerapp.ps1
#>

[CmdletBinding()]
param(
    [string]$SubscriptionId,
    [string]$Location,
    [string]$ResourceGroupName,
    [string]$ContainerRegistryName,
    [string]$EnvironmentName,
    [string]$ContainerAppName,
    [string]$SpeechAccountName,
    [SecureString]$DirectLineSecret,
    [ValidateSet("global", "europe")]
    [string]$DirectLineRegion,
    [string]$TrustedOrigins = ""
)

$ErrorActionPreference = "Stop"

$CommonLocations = @(
    "westeurope", "northeurope", "eastus", "eastus2", "westus2", "westus3",
    "centralus", "uksouth", "francecentral", "germanywestcentral",
    "switzerlandnorth", "swedencentral", "australiaeast", "southeastasia",
    "japaneast"
)

function Select-OrNew {
    param(
        [Parameter(Mandatory)] [string]$Title,
        [Parameter(Mandatory)] [AllowEmptyCollection()] [array]$Options,
        [string]$NewLabel = "[NEW] Create new"
    )
    Write-Host "`n=== $Title ===" -ForegroundColor Cyan
    if ($Options.Count -eq 0) {
        Write-Host "(none found — will create new)" -ForegroundColor DarkYellow
        return $null
    }
    for ($i = 0; $i -lt $Options.Count; $i++) {
        Write-Host ("  {0,2}. {1}" -f ($i + 1), $Options[$i]) -ForegroundColor Yellow
    }
    Write-Host ("  {0,2}. {1}" -f 0, $NewLabel) -ForegroundColor Green
    do {
        $sel = Read-Host "`nEnter selection (0-$($Options.Count))"
        $valid = $sel -match '^\d+$' -and [int]$sel -ge 0 -and [int]$sel -le $Options.Count
        if (-not $valid) { Write-Host "Invalid selection." -ForegroundColor Red }
    } while (-not $valid)
    if ([int]$sel -eq 0) { return $null }
    return $Options[[int]$sel - 1]
}

function ConvertFrom-SecureToPlain {
    param([SecureString]$Secure)
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
    finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# --- Login + subscription ---
$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) { az login | Out-Null; $account = az account show | ConvertFrom-Json }
Write-Host "✅ Logged in as $($account.user.name)" -ForegroundColor Green

if (-not $SubscriptionId) {
    $subs = az account list --query "[].{name:name,id:id}" -o json | ConvertFrom-Json
    if ($subs.Count -gt 1) {
        $opts = $subs | ForEach-Object { "$($_.name)  ($($_.id))" }
        $pick = Select-OrNew -Title "Select Azure Subscription" -Options $opts -NewLabel "[NEW] Enter a different Subscription ID"
        if ($null -eq $pick) { $SubscriptionId = Read-Host "Enter Subscription ID" }
        else { $SubscriptionId = ($subs[[array]::IndexOf($opts, $pick)]).id }
    } else { $SubscriptionId = $account.id }
}
az account set --subscription $SubscriptionId | Out-Null
$account = az account show | ConvertFrom-Json
Write-Host "✅ Subscription: $($account.name)" -ForegroundColor Green

# --- Location ---
if (-not $Location) {
    $pick = Select-OrNew -Title "Select Default Location (for any new resources)" -Options $CommonLocations -NewLabel "[NEW] Enter a different region"
    if ($null -eq $pick) { $Location = Read-Host "Enter Azure region (e.g. eastus)" } else { $Location = $pick }
}
Write-Host "✅ Location: $Location" -ForegroundColor Green

# --- Resource Group ---
if (-not $ResourceGroupName) {
    $rgs = @(az group list --query "[].name" -o json | ConvertFrom-Json | Sort-Object)
    $pick = Select-OrNew -Title "Select Resource Group" -Options $rgs
    if ($null -eq $pick) { $ResourceGroupName = Read-Host "Enter new Resource Group name" } else { $ResourceGroupName = $pick }
}
if ((az group exists -n $ResourceGroupName) -eq "false") {
    Write-Host "📦 Creating Resource Group: $ResourceGroupName ($Location)" -ForegroundColor Cyan
    az group create -n $ResourceGroupName -l $Location | Out-Null
}
Write-Host "✅ Resource Group: $ResourceGroupName" -ForegroundColor Green

# --- Container Registry ---
if (-not $ContainerRegistryName) {
    $acrs = @(az acr list --query "[].name" -o json | ConvertFrom-Json | Sort-Object)
    $pick = Select-OrNew -Title "Select Container Registry" -Options $acrs
    if ($null -eq $pick) { $ContainerRegistryName = Read-Host "Enter new Container Registry name (alphanumeric only)" }
    else { $ContainerRegistryName = $pick }
}
if ($ContainerRegistryName -notmatch '^[a-zA-Z0-9]+$') { Write-Error "ACR name must be alphanumeric only"; exit 1 }
$acrDetails = az acr show -n $ContainerRegistryName 2>$null | ConvertFrom-Json
if (-not $acrDetails) {
    Write-Host "📦 Creating ACR: $ContainerRegistryName in $ResourceGroupName ($Location)" -ForegroundColor Cyan
    az acr create -g $ResourceGroupName -n $ContainerRegistryName --sku Basic --location $Location --admin-enabled true | Out-Null
    $acrDetails = az acr show -n $ContainerRegistryName | ConvertFrom-Json
}
$acrLoginServer = $acrDetails.loginServer
$acrUsername    = az acr credential show -n $ContainerRegistryName --query "username" -o tsv
$acrPassword    = az acr credential show -n $ContainerRegistryName --query "passwords[0].value" -o tsv
Write-Host "✅ Container Registry: $ContainerRegistryName" -ForegroundColor Green

# --- Container Apps Environment ---
if (-not $EnvironmentName) {
    $envsInRg = @(az containerapp env list -g $ResourceGroupName --query "[].name" -o json 2>$null | ConvertFrom-Json | Sort-Object)
    if ($envsInRg.Count -gt 0) {
        $pick = Select-OrNew -Title "Select Container Apps Environment (in RG '$ResourceGroupName')" -Options $envsInRg
    } else {
        $allEnvs = @(az containerapp env list --query "[].{name:name,rg:resourceGroup}" -o json 2>$null | ConvertFrom-Json)
        if ($allEnvs.Count -gt 0) {
            $opts = $allEnvs | ForEach-Object { "$($_.name)  (RG: $($_.rg))" }
            $pick = Select-OrNew -Title "Select Container Apps Environment (subscription-wide)" -Options $opts
            if ($pick) { $pick = ($allEnvs[[array]::IndexOf($opts, $pick)]).name }
        } else { $pick = Select-OrNew -Title "Select Container Apps Environment" -Options @() }
    }
    if ($null -eq $pick) { $EnvironmentName = Read-Host "Enter new Container Apps Environment name" } else { $EnvironmentName = $pick }
}
$envExists = az containerapp env show -n $EnvironmentName -g $ResourceGroupName 2>$null
if (-not $envExists) {
    Write-Host "📦 Creating Container Apps Environment: $EnvironmentName ($Location)" -ForegroundColor Cyan
    az containerapp env create -n $EnvironmentName -g $ResourceGroupName --location $Location | Out-Null
}
Write-Host "✅ Container Apps Environment: $EnvironmentName" -ForegroundColor Green

# --- Container App ---
if (-not $ContainerAppName) {
    $appsInRg = @(az containerapp list -g $ResourceGroupName --query "[].name" -o json 2>$null | ConvertFrom-Json | Sort-Object)
    $pick = Select-OrNew -Title "Select Container App to update (or [NEW])" -Options $appsInRg
    if ($null -eq $pick) { $ContainerAppName = Read-Host "Enter new Container App name (e.g. postal-voicechat)" }
    else { $ContainerAppName = $pick }
}
Write-Host "✅ Container App: $ContainerAppName" -ForegroundColor Green

# --- Azure AI Speech ---
if (-not $SpeechAccountName) {
    $speechAccts = @(az cognitiveservices account list --query "[?kind=='SpeechServices'].{name:name,rg:resourceGroup,loc:location}" -o json 2>$null | ConvertFrom-Json)
    if ($speechAccts.Count -eq 0) {
        Write-Error "No Azure AI Speech accounts found. Run provision-azure.ps1 first."; exit 1
    }
    $opts = $speechAccts | ForEach-Object { "$($_.name)  (RG: $($_.rg), $($_.loc))" }
    $pick = Select-OrNew -Title "Select Azure AI Speech account" -Options $opts -NewLabel "[NEW] Enter name of a different Speech account"
    if ($null -eq $pick) {
        $SpeechAccountName = Read-Host "Enter Speech account name"
        $speechMatch = az cognitiveservices account list --query "[?name=='$SpeechAccountName'] | [0]" -o json | ConvertFrom-Json
        if (-not $speechMatch) { Write-Error "Speech account '$SpeechAccountName' not found"; exit 1 }
        $speechRG = $speechMatch.resourceGroup
    } else {
        $entry = $speechAccts[[array]::IndexOf($opts, $pick)]
        $SpeechAccountName = $entry.name
        $speechRG = $entry.rg
    }
} else {
    $speechMatch = az cognitiveservices account list --query "[?name=='$SpeechAccountName'] | [0]" -o json | ConvertFrom-Json
    $speechRG = $speechMatch.resourceGroup
}
$SpeechKeyPlain = az cognitiveservices account keys list -n $SpeechAccountName -g $speechRG --query "key1" -o tsv
$SpeechRegion   = az cognitiveservices account show     -n $SpeechAccountName -g $speechRG --query "location" -o tsv
Write-Host "✅ Speech: $SpeechAccountName ($SpeechRegion)" -ForegroundColor Green

# --- Direct Line region + secret ---
if (-not $DirectLineRegion) {
    $pick = Select-OrNew -Title "Direct Line endpoint region" -Options @("global", "europe") -NewLabel "[NEW] Enter a custom value"
    if ($null -eq $pick) { $DirectLineRegion = Read-Host "Enter value" } else { $DirectLineRegion = $pick }
}
if (-not $DirectLineSecret) {
    $DirectLineSecret = Read-Host "Direct Line secret (Copilot Studio > Settings > Channels > Custom website)" -AsSecureString
}
$dlPlain = ConvertFrom-SecureToPlain $DirectLineSecret

# --- Build image in ACR ---
$imageRepo   = $ContainerAppName.ToLower()
$timestamp   = Get-Date -Format "yyyyMMddHHmmss"
$imageLatest = "$acrLoginServer/${imageRepo}:latest"

Write-Host "`n🏗️  Building image in ACR: $imageRepo (tag: $timestamp + latest)" -ForegroundColor Cyan
az acr build `
    --registry $ContainerRegistryName `
    --image "${imageRepo}:$timestamp" `
    --image "${imageRepo}:latest" `
    --platform linux/amd64 `
    --file Dockerfile `
    .
if ($LASTEXITCODE -ne 0) { Write-Error "ACR build failed"; exit 1 }
Write-Host "✅ Image pushed" -ForegroundColor Green

# --- Secrets + env ---
$secretArgs = @(
    "directline-secret=$dlPlain",
    "speech-key=$SpeechKeyPlain"
)
$envArgs = @(
    "DIRECTLINE_SECRET=secretref:directline-secret",
    "SPEECH_KEY=secretref:speech-key",
    "SPEECH_REGION=$SpeechRegion",
    "DIRECTLINE_REGION=$DirectLineRegion",
    "ALLOWED_ORIGINS=*",
    "PORT=3000"
)
if ($TrustedOrigins) { $envArgs += "TRUSTED_ORIGINS=$TrustedOrigins" }

# --- Create or update Container App ---
Write-Host "`n🚀 Deploying Container App: $ContainerAppName" -ForegroundColor Cyan
$appExists = az containerapp show -n $ContainerAppName -g $ResourceGroupName 2>$null

if (-not $appExists) {
    az containerapp create `
        --name $ContainerAppName `
        --resource-group $ResourceGroupName `
        --environment $EnvironmentName `
        --image $imageLatest `
        --revision-suffix "r$timestamp" `
        --registry-server $acrLoginServer `
        --registry-username $acrUsername `
        --registry-password $acrPassword `
        --target-port 80 `
        --ingress external `
        --cpu 0.5 `
        --memory 1.0Gi `
        --min-replicas 1 `
        --max-replicas 3 `
        --secrets $secretArgs `
        --env-vars $envArgs
} else {
    az containerapp secret set `
        --name $ContainerAppName `
        --resource-group $ResourceGroupName `
        --secrets $secretArgs | Out-Null
    az containerapp update `
        --name $ContainerAppName `
        --resource-group $ResourceGroupName `
        --image $imageLatest `
        --revision-suffix "r$timestamp" `
        --set-env-vars $envArgs
}
if ($LASTEXITCODE -ne 0) { Write-Error "Container App deployment failed"; exit 1 }

$fqdn = az containerapp show -n $ContainerAppName -g $ResourceGroupName --query "properties.configuration.ingress.fqdn" -o tsv

Write-Host "`n═══════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "🎉 Deployment complete" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "🌐 URL:    https://$fqdn" -ForegroundColor Yellow
Write-Host "🔬 Health: https://$fqdn/healthz" -ForegroundColor Cyan
Write-Host "📊 Logs:   az containerapp logs show -n $ContainerAppName -g $ResourceGroupName --follow" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
