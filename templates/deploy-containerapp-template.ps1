#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Deploy the Copilot Studio Web Client to Azure Container Apps

.DESCRIPTION
    This script builds a Docker container image and deploys it to Azure Container Apps.
    It allows interactive selection of resource group and container registry.

.PARAMETER ResourceGroupName
    Name of the Azure Resource Group (optional - will prompt if not provided)

.PARAMETER ContainerRegistryName
    Name of the Azure Container Registry (optional - will prompt if not provided)

.PARAMETER Location
    Azure region for new resources (default: westeurope)

.PARAMETER ContainerAppName
    Name of the Container App to create (default: copilot-webclient)

.PARAMETER EnvironmentName
    Name of the Container App Environment (default: copilot-env)

.PARAMETER ImageTag
    Tag for the Docker image (default: latest)

.EXAMPLE
    .\deploy-containerapp.ps1
    
.EXAMPLE
    .\deploy-containerapp.ps1 -ResourceGroupName "rg-copilot" -ContainerRegistryName "myacr"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$ResourceGroupName,

    [Parameter(Mandatory = $false)]
    [string]$ContainerRegistryName,

    [Parameter(Mandatory = $false)]
    [string]$Location = "westeurope",

    [Parameter(Mandatory = $false)]
    [string]$ContainerAppName = "aschimcswebclient",

    [Parameter(Mandatory = $false)]
    [string]$EnvironmentName = "aschimcswebclient-env",

    [Parameter(Mandatory = $false)]
    [string]$ImageTag = "latest"
)

$ErrorActionPreference = "Stop"

# Function to display menu and get selection
function Show-Menu {
    param(
        [string]$Title,
        [array]$Options
    )
    
    Write-Host "`n=== $Title ===" -ForegroundColor Cyan
    for ($i = 0; $i -lt $Options.Count; $i++) {
        Write-Host "$($i + 1). $($Options[$i])" -ForegroundColor Yellow
    }
    Write-Host "0. Create New" -ForegroundColor Green
    
    do {
        $selection = Read-Host "`nEnter selection (0-$($Options.Count))"
        $valid = $selection -match '^\d+$' -and [int]$selection -ge 0 -and [int]$selection -le $Options.Count
        if (-not $valid) {
            Write-Host "Invalid selection. Please try again." -ForegroundColor Red
        }
    } while (-not $valid)
    
    return [int]$selection
}

# Check if logged in to Azure
Write-Host "`n🔍 Checking Azure login status..." -ForegroundColor Cyan
$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Host "❌ Not logged in to Azure. Please login..." -ForegroundColor Red
    az login
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Azure login failed"
        exit 1
    }
    $account = az account show | ConvertFrom-Json
}

Write-Host "✅ Logged in as: $($account.user.name)" -ForegroundColor Green
Write-Host "📋 Subscription: $($account.name) ($($account.id))" -ForegroundColor Green

# Select or create Resource Group
if (-not $ResourceGroupName) {
    Write-Host "`n🔍 Loading resource groups..." -ForegroundColor Cyan
    $resourceGroups = az group list --query "[].name" -o json | ConvertFrom-Json | Sort-Object
    
    if ($resourceGroups.Count -eq 0) {
        Write-Host "⚠️  No resource groups found. Creating new one..." -ForegroundColor Yellow
        $ResourceGroupName = Read-Host "Enter new Resource Group name"
    }
    else {
        $selection = Show-Menu -Title "Select Resource Group" -Options $resourceGroups
        
        if ($selection -eq 0) {
            $ResourceGroupName = Read-Host "Enter new Resource Group name"
        }
        else {
            $ResourceGroupName = $resourceGroups[$selection - 1]
        }
    }
}

# Create Resource Group if it doesn't exist
$rgExists = az group exists -n $ResourceGroupName
if ($rgExists -eq "false") {
    Write-Host "`n📦 Creating Resource Group: $ResourceGroupName" -ForegroundColor Cyan
    az group create --name $ResourceGroupName --location $Location
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create resource group"
        exit 1
    }
    Write-Host "✅ Resource Group created" -ForegroundColor Green
}
else {
    Write-Host "✅ Using existing Resource Group: $ResourceGroupName" -ForegroundColor Green
}

# Select or create Container Registry
$acrResourceGroup = $null
if (-not $ContainerRegistryName) {
    Write-Host "`n🔍 Loading container registries..." -ForegroundColor Cyan
    $registriesDetails = az acr list --query "[].[name, resourceGroup]" -o json | ConvertFrom-Json
    
    if ($registriesDetails.Count -eq 0) {
        Write-Host "⚠️  No container registries found. Creating new one..." -ForegroundColor Yellow
        $ContainerRegistryName = Read-Host "Enter new Container Registry name (alphanumeric only)"
    }
    else {
        $registryNames = $registriesDetails | ForEach-Object { "$($_[0]) (RG: $_[1])" }
        $selection = Show-Menu -Title "Select Container Registry" -Options $registryNames
        
        if ($selection -eq 0) {
            $ContainerRegistryName = Read-Host "Enter new Container Registry name (alphanumeric only)"
        }
        else {
            $selectedRegistry = $registriesDetails[$selection - 1]
            $ContainerRegistryName = $selectedRegistry[0]
            $acrResourceGroup = $selectedRegistry[1]
            Write-Host "ℹ️  Selected ACR '$ContainerRegistryName' from resource group '$acrResourceGroup'" -ForegroundColor Cyan
        }
    }
}

# Validate ACR name
if ($ContainerRegistryName -notmatch '^[a-zA-Z0-9]+$') {
    Write-Error "Container Registry name must contain only alphanumeric characters"
    exit 1
}

# Check if ACR exists (anywhere) and get its resource group
Write-Host "`n🔍 Checking if Container Registry exists..." -ForegroundColor Cyan
$acrDetails = az acr show -n $ContainerRegistryName 2>$null | ConvertFrom-Json

if (-not $acrDetails) {
    # ACR doesn't exist, create it in the selected resource group
    Write-Host "📦 Creating Container Registry: $ContainerRegistryName" -ForegroundColor Cyan
    az acr create `
        --resource-group $ResourceGroupName `
        --name $ContainerRegistryName `
        --sku Basic `
        --location $Location `
        --admin-enabled true
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create container registry"
        exit 1
    }
    $acrResourceGroup = $ResourceGroupName
    Write-Host "✅ Container Registry created" -ForegroundColor Green
}
else {
    # ACR exists, use its resource group
    $acrResourceGroup = $acrDetails.resourceGroup
    Write-Host "✅ Using existing Container Registry: $ContainerRegistryName (in $acrResourceGroup)" -ForegroundColor Green
}

# Get ACR credentials
Write-Host "`n🔐 Getting ACR credentials..." -ForegroundColor Cyan
$acrLoginServer = az acr show -n $ContainerRegistryName --query "loginServer" -o tsv
$acrUsername = az acr credential show -n $ContainerRegistryName --query "username" -o tsv
$acrPassword = az acr credential show -n $ContainerRegistryName --query "passwords[0].value" -o tsv

# Build Docker image in ACR and tag both timestamp + latest
# Docker requires lowercase repository names
$imageRepository = $ContainerAppName.ToLower()

# Use timestamp-based tag for unique versioning, plus latest tag
$timestamp = Get-Date -Format "yyyyMMddHHmmss"
$imageNameWithTag = "$acrLoginServer/${imageRepository}:$timestamp"
$imageNameLatest = "$acrLoginServer/${imageRepository}:latest"

Write-Host "`n🏗️  Building image in ACR: $imageNameWithTag and :latest" -ForegroundColor Cyan
Write-Host "ℹ️  Running remote ACR build to avoid local Docker dependency" -ForegroundColor Cyan

az acr build `
    --registry $ContainerRegistryName `
    --image "${imageRepository}:$timestamp" `
    --image "${imageRepository}:latest" `
    --platform linux/amd64 `
    --file Dockerfile `
    .

if ($LASTEXITCODE -ne 0) {
    Write-Error "ACR build failed"
    exit 1
}

Write-Host "✅ ACR build completed and images pushed" -ForegroundColor Green

# Always deploy latest image tag to Container App
$imageName = $imageNameLatest

# Create Container App Environment if it doesn't exist
Write-Host "`n🔍 Checking Container App Environment..." -ForegroundColor Cyan
$envExists = az containerapp env show -n $EnvironmentName -g $ResourceGroupName 2>$null
if (-not $envExists) {
    Write-Host "📦 Creating Container App Environment: $EnvironmentName" -ForegroundColor Cyan
    az containerapp env create `
        --name $EnvironmentName `
        --resource-group $ResourceGroupName `
        --location $Location
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create Container App Environment"
        exit 1
    }
    Write-Host "✅ Container App Environment created" -ForegroundColor Green
}
else {
    Write-Host "✅ Using existing Container App Environment: $EnvironmentName" -ForegroundColor Green
}

# Create or update Container App
Write-Host "`n🚀 Deploying Container App: $ContainerAppName" -ForegroundColor Cyan
$appExists = az containerapp show -n $ContainerAppName -g $ResourceGroupName 2>$null

if (-not $appExists) {
    # Create new Container App
    Write-Host "📦 Creating new Container App..." -ForegroundColor Cyan
    az containerapp create `
        --name $ContainerAppName `
        --resource-group $ResourceGroupName `
        --environment $EnvironmentName `
        --image $imageName `
        --revision-suffix "r$timestamp" `
        --registry-server $acrLoginServer `
        --registry-username $acrUsername `
        --registry-password $acrPassword `
        --target-port 80 `
        --ingress external `
        --cpu 0.5 `
        --memory 1.0Gi `
        --min-replicas 1 `
        --max-replicas 3
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create Container App"
        exit 1
    }
}
else {
    # Update existing Container App
    Write-Host "🔄 Updating existing Container App..." -ForegroundColor Cyan
    az containerapp update `
        --name $ContainerAppName `
        --resource-group $ResourceGroupName `
        --image $imageName `
        --revision-suffix "r$timestamp"
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to update Container App"
        exit 1
    }
}

# Get the app URL
$appUrl = az containerapp show `
    --name $ContainerAppName `
    --resource-group $ResourceGroupName `
    --query "properties.configuration.ingress.fqdn" `
    -o tsv

Write-Host "`n" -NoNewline
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "🎉 Deployment completed successfully!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Deployment Summary:" -ForegroundColor Cyan
Write-Host "   Resource Group:    $ResourceGroupName" -ForegroundColor White
Write-Host "   Container Registry: $ContainerRegistryName" -ForegroundColor White
Write-Host "   Container App:     $ContainerAppName" -ForegroundColor White
Write-Host "   Image:            $imageName" -ForegroundColor White
Write-Host ""
Write-Host "🌐 Application URL:" -ForegroundColor Cyan
Write-Host "   https://$appUrl" -ForegroundColor Yellow
Write-Host ""
Write-Host "📊 View logs:" -ForegroundColor Cyan
Write-Host "   az containerapp logs show -n $ContainerAppName -g $ResourceGroupName --follow" -ForegroundColor White
Write-Host ""
Write-Host "🔍 Monitor in Portal:" -ForegroundColor Cyan
Write-Host "   https://portal.azure.com/#resource/subscriptions/$($account.id)/resourceGroups/$ResourceGroupName/providers/Microsoft.App/containerApps/$ContainerAppName" -ForegroundColor White
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
