#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Provision Azure resources for the Copilot Studio voice webchat.

.DESCRIPTION
    Interactive — for EVERY resource (Subscription, Location, Resource Group,
    Container Registry, Container Apps Environment, Azure AI Speech) you can
    list existing instances, select one, or pick [NEW] to create one on the fly.

.EXAMPLE
    .\provision-azure.ps1
#>

[CmdletBinding()]
param(
    [string]$SubscriptionId,
    [string]$ResourceGroupName,
    [string]$Location,
    [string]$ContainerRegistryName,
    [string]$EnvironmentName,
    [string]$SpeechAccountName
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

# --- Azure login + subscription ---
Write-Host "`n🔍 Checking Azure login..." -ForegroundColor Cyan
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
    $pick = Select-OrNew -Title "Select Default Location (for new resources)" -Options $CommonLocations -NewLabel "[NEW] Enter a different region"
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
}
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

# --- Azure AI Speech ---
if (-not $SpeechAccountName) {
    $speechAccts = @(az cognitiveservices account list --query "[?kind=='SpeechServices'].{name:name,rg:resourceGroup,loc:location}" -o json 2>$null | ConvertFrom-Json)
    if ($speechAccts.Count -eq 0) {
        $pick = Select-OrNew -Title "Select Azure AI Speech account" -Options @()
        $SpeechAccountName = Read-Host "Enter new Speech account name"
    } else {
        $opts = $speechAccts | ForEach-Object { "$($_.name)  (RG: $($_.rg), $($_.loc))" }
        $pick = Select-OrNew -Title "Select Azure AI Speech account" -Options $opts
        if ($null -eq $pick) { $SpeechAccountName = Read-Host "Enter new Speech account name" }
        else { $SpeechAccountName = ($speechAccts[[array]::IndexOf($opts, $pick)]).name }
    }
}
$existingAcct = az cognitiveservices account list --query "[?name=='$SpeechAccountName'] | [0]" -o json 2>$null | ConvertFrom-Json
if ($existingAcct) {
    $speechRG = $existingAcct.resourceGroup
    Write-Host "ℹ️  Using existing Speech account '$SpeechAccountName' in RG '$speechRG'" -ForegroundColor DarkYellow
} else {
    Write-Host "📦 Creating Azure AI Speech: $SpeechAccountName ($Location)" -ForegroundColor Cyan
    az cognitiveservices account create `
        --name $SpeechAccountName --resource-group $ResourceGroupName `
        --kind SpeechServices --sku S0 --location $Location --yes | Out-Null
    $speechRG = $ResourceGroupName
}
Write-Host "✅ Speech account: $SpeechAccountName (RG: $speechRG)" -ForegroundColor Green

$speechKey    = az cognitiveservices account keys list -n $SpeechAccountName -g $speechRG --query "key1" -o tsv
$speechRegion = az cognitiveservices account show     -n $SpeechAccountName -g $speechRG --query "location" -o tsv

Write-Host "`n═══════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "🎉 Provisioning complete" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "Use the following with deploy-containerapp.ps1:" -ForegroundColor Cyan
Write-Host "   SubscriptionId        : $SubscriptionId" -ForegroundColor White
Write-Host "   Location              : $Location" -ForegroundColor White
Write-Host "   ResourceGroupName     : $ResourceGroupName" -ForegroundColor White
Write-Host "   ContainerRegistryName : $ContainerRegistryName" -ForegroundColor White
Write-Host "   EnvironmentName       : $EnvironmentName" -ForegroundColor White
Write-Host "   SpeechAccountName     : $SpeechAccountName" -ForegroundColor White
Write-Host "   SpeechRegion          : $speechRegion" -ForegroundColor White
Write-Host ""
Write-Host "You'll also need your Copilot Studio Direct Line secret." -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green

$global:POSTAL_SUB           = $SubscriptionId
$global:POSTAL_LOCATION      = $Location
$global:POSTAL_RG            = $ResourceGroupName
$global:POSTAL_ACR           = $ContainerRegistryName
$global:POSTAL_ENV           = $EnvironmentName
$global:POSTAL_SPEECH_NAME   = $SpeechAccountName
$global:POSTAL_SPEECH_KEY    = $speechKey
$global:POSTAL_SPEECH_REGION = $speechRegion
