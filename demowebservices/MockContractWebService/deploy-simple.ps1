# Azure Container Apps Simple Deployment Script
# This script deploys directly from source (no ACR needed)

param(
    [Parameter(Mandatory=$false)]
    [string]$ResourceGroup = "WebApps",
    
    [Parameter(Mandatory=$false)]
    [string]$Location = "westus",
    
    [Parameter(Mandatory=$false)]
    [string]$AppName = "aschi-custom-contract-api"
)

Write-Host "🚀 Deploying Mock Contract API to Azure Container Apps" -ForegroundColor Cyan
Write-Host ""

# Check if logged in to Azure
Write-Host "Checking Azure login..." -ForegroundColor Yellow
$account = az account show 2>$null
if (-not $account) {
    Write-Host "Please login to Azure" -ForegroundColor Red
    az login
}

# Install/update Container Apps extension
Write-Host "Ensuring Container Apps extension is installed..." -ForegroundColor Yellow
az extension add --name containerapp --upgrade --only-show-errors

# Create resource group if it doesn't exist
Write-Host "Checking if resource group exists: $ResourceGroup" -ForegroundColor Yellow
$rgExists = az group exists --name $ResourceGroup --output tsv
if ($rgExists -eq "false") {
    Write-Host "Creating resource group: $ResourceGroup" -ForegroundColor Yellow
    az group create --name $ResourceGroup --location $Location --output none
} else {
    Write-Host "Resource group already exists: $ResourceGroup" -ForegroundColor Green
}

# Deploy using 'az containerapp up' - builds container automatically
Write-Host "Building and deploying Container App (this may take a few minutes)..." -ForegroundColor Yellow
az containerapp up `
    --name $AppName `
    --resource-group $ResourceGroup `
    --location $Location `
    --source . `
    --target-port 8080 `
    --ingress external `
    --env-vars ASPNETCORE_ENVIRONMENT=Production

# Get the app URL
$appUrl = az containerapp show `
    --name $AppName `
    --resource-group $ResourceGroup `
    --query properties.configuration.ingress.fqdn `
    --output tsv

az containerapp update `
  --name $AppName `
  --resource-group $ResourceGroup `
  --set-env-vars "ApiKey=your-secure-api-key-here"

Write-Host ""
Write-Host "✅ Deployment complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📍 Your API is available at:" -ForegroundColor Cyan
Write-Host "   https://$appUrl" -ForegroundColor White
Write-Host ""
Write-Host "🧪 Test endpoints:" -ForegroundColor Cyan
Write-Host "   Metadata: https://$appUrl/b2bapi/v2/contract-draft-request/metadata" -ForegroundColor White
Write-Host "   Options:  https://$appUrl/b2bapi/v2/fields/options" -ForegroundColor White
Write-Host "   Swagger:  https://$appUrl/swagger" -ForegroundColor White
Write-Host ""
Write-Host "💡 To update your app, just run this script again!" -ForegroundColor Yellow
