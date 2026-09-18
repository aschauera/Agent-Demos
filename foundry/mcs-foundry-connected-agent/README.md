# HR Systems Expert

`hr-systems-expert` is a Microsoft Foundry hosted demo agent that mimics read-only access to HR line-of-business systems. It serves Responses and Activity from one Python process and exposes A2A through Foundry. Its local tools cover:

- job role profiles
- salary ranges
- job-leveling data
- role search

All returned records are fictional and intended only for demonstrations.

## Sample questions

- `What is the salary range for a Power Platform Architect?`
- `What is the typical job level for a Power Platform developer?`
- `Describe the responsibilities of a Senior Power Platform Developer.`
- `Which roles match Power Platform?`

## Local development

Prerequisites:

- Python 3.13
- Azure CLI authenticated with `az login`
- Azure Developer CLI authenticated with `azd auth login`
- The `microsoft.foundry` azd extension

```powershell
cd src\hr-systems-expert
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install uv
uv pip install -r requirements.txt
cd ..\..

$env:FOUNDRY_PROJECT_ENDPOINT = "<project-endpoint>"
$env:AZURE_AI_MODEL_DEPLOYMENT_NAME = "<model-deployment-name>"
$env:AZURE_DEV_USER_AGENT = "microsoft_foundry_skill"
azd ai agent run --no-client
```

In another terminal:

```powershell
$env:AZURE_DEV_USER_AGENT = "microsoft_foundry_skill"
azd ai agent invoke --local "What is the salary range for a Power Platform Architect?"
```

## Deploy

Authenticate first:

```powershell
azd auth login
az login
```

Then provision a new Foundry project and deploy:

```powershell
.\scripts\deploy.ps1
```

Optional parameters:

```powershell
.\scripts\deploy.ps1 `
  -EnvironmentName hr-systems-expert-dev `
  -ProjectName hr-systems-expert `
  -ResourceGroupName rg-hr-systems-expert-dev `
  -ModelDeploymentName gpt-5.4-mini `
  -Location northcentralus `
  -SubscriptionId "<subscription-guid>" `
  -SmokeTest
```

The script provisions all Azure resources into a dedicated resource group. By default, its name is `rg-<EnvironmentName>` (`rg-hr-systems-expert-dev` with the defaults); use `-ResourceGroupName` to override it. It then deploys the Foundry project, model deployment, and hosted agent, optionally runs a billed smoke test, and submits asynchronous evaluation-suite generation.

This is resource-group isolation for lifecycle, RBAC, billing, and cleanup. It does not enable network isolation or private endpoints.

## Copilot Studio connection

The deployment declares Foundry Responses, Agent2Agent (A2A), and Activity protocols. Its approved agent card advertises the `HR Job Data` skill for discovery by Copilot Studio and other A2A clients. Direct Responses and A2A calls use `Entra`; the Activity endpoint uses `BotServiceTenant` so authenticated users in the configured tenant can invoke it through Copilot Studio's **Microsoft Foundry** external-agent connection.

After deployment, use the A2A endpoint returned by:

```powershell
$env:AZURE_DEV_USER_AGENT = "microsoft_foundry_skill"
azd ai agent show --output json
```
