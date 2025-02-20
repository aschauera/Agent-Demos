# Copilot Studio - Direct Line Speech Sample

Welcome to the Copilot Studio Direct Line speech sample. This sample demonstrates how to publish a Copilot Studio agent over DirectLine Speech to use enable bi-directional voice interactions.

## Table of Contents

- [Introduction](#introduction)
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Sample Clients](#sampleClients)
- [Contributing](#contributing)
- [License](#license)

## Introduction

The sample uses Azure Bot Service as a Relay between the DirectLine speech channel and the published Copilot Studio agent.
The [Azure Bot Service](https://docs.microsoft.com/en-us/azure/bot-service/) implementations uses Azure Speech services for Text-To-Speech and Speech-to-text over the DirectLine.
The goal of this sample is to have a Speech Enabled Copilot Studio bot published on a DirectLine Speech Channel using all the latest available features in Copilot Studio like Generative Orchestration.


## Features

- Use voice to interact with any Copilot Studio agent
- Leverages Azure Speech for multilingual TTS and STT

## Installation

***NOTE:***
A feature called ***Allowlists*** is upcoming that will eliminate the need for custom implementation and allow Azure Bot Framework to call a Copilot Studion bot as a skill
This feature is today only available for classic Copilots.
[Use a classic chatbot as a skill](https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-use-pva-as-a-skill)

This bot has been created based on [Azure Bot Service](https://dev.botframework.com), it shows how to create an Azure Bot Service bot that connects to a Copilot Studio bot via Direct Line API

## Prerequisites

- [.NET Core SDK](https://dotnet.microsoft.com/download) version 2.1

  ```bash
  # determine dotnet version
  dotnet --version
  ```
- [Power Platform CLI](https://learn.microsoft.com/en-us/power-platform/developer/cli/introduction?tabs=windows#install-microsoft-power-platform-cli)

  ```bash
  # install PAC CLI via dotnet tool
  dotnet tool install --global Microsoft.PowerApps.CLI.Tool
  ```
- [Aure Command Line Interface](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-windows?tabs=azure-cli#install-or-update)


## Setup
### Setup required resources in Microsoft Azure

The following sets up Azure Cognitive Services for speech as well as an App Service plan, a web app and an Azure Bot. Found in
[AZ CLI deployment scrapbook](/VoiceAgentSample/DeploymentScripts/VoiceAgent_CreateResources.azcli)

- Deploy Azure resources

    ```powershell
    # Assign values to variables
    $ressourceGroup="VoiceAgentSample"
    $location="westeurope"
    $appServiceName="VoiceAgentSampleAppPlan"
    $webAppName="VoiceAgentSampleWebApp"
    $cognitiveServiceAccountName="VoiceAgentSampleAIService"
    $botName="VoiceAgentBot"
    $appRegistrationName="VoiceAgentSamplePrincipal"
    $tenantId="<tenantID>"
    $webAppEndoint=echo https://$webAppName.azurewebsites.net/api/messages
    ##Make sure to use the right subscription
    $subscriptionId=<ID from az account set output>
    ##Connect to Azure subscroption
    az login
    az account set --subscription $subscriptionId

    ##Create speech services
    az group create --location westeurope --name $ressourceGroup
    az cognitiveservices account create -n $cognitiveServiceAccountName -g $ressourceGroup --kind SpeechServices --sku F0 -l $location --yes
    $cognitiveServicesKey=$(az cognitiveservices account keys list -n $cognitiveServiceAccountName -g $ressourceGroup --query "key1")

    ##Create app plan and web app
    az appservice plan create -g $ressourceGroup -n $appServiceName --sku F1 --location $location
    az webapp create -g $ressourceGroup -n $webAppName -p $appServiceName

    #Enable web sockets on the app
    az webapp config set -g $ressourceGroup -n $webAppName --web-sockets-enabled true
    #Create multi tenant app registration
    $appId = $(az ad app create --display-name $appRegistrationName --query "appId" --sign-in-audience AzureADMultipleOrgs)
    ## Create the Azure Bot service bot
    az bot create -g $ressourceGroup -n $botName --app-type MultiTenant --appid $appId --tenant-id $tenantId
    #Set bot endpoint to web app path
    az bot update -g $ressourceGroup -n $botName --endpoint $webAppEndoint
    ```
- Enable DirectLine Speech

  - In [Azure Portal](https://portal.azure.com) go to your bot resource you created ***Settings*** > ***Channels*** > ***Available Channels*** > ***Direct Line Speech***. Select the Cognitive Service resource created earlier and leave the optional fields blank and save.
  - In your bot resource go to  ***Settings*** > ***Configuration*** and check **Enable Streaming Endpoint**


### Compile the bot

- Clone the repository

    ```bash
    #Clone Echo bot sample
    git clone https://github.com/aschauera/Agent-Demos.git
    ```

- In a terminal, navigate to `VoiceAgentSample/`
- Create a file named `appsettings.json` in the project root to store the app configuration and IDs.
- Update the file `appsettings.json` with your Copilot Studio bot id, tenant id, bot name and other settings.
    
    If you used the deployment from step 1 the MicrosoftAppId is already available in the variable $appId. Alternatively this can be found 
    in Azure Portal <Your bot resource> navigate to ***Settings*** then ***Configuration*** and copy the Microsoft App ID and Tenant ID.
    The MicrosoftAppPassword can be found by clicking on ***Manage Password*** and ***Certificates & Secrets***. Create a new secret and copy its value.
    ```  
    "MicrosoftAppId": "aaa",
    "MicrosoftAppPassword": "bbb",
    "MicrosoftAppTenantId":"ccc",
    ```
    To retrieve your Copilot Studio bot's token endpoint, click on left side pane's ***Manage***, click ***Channels*** and click on the Direct Line Speech channel.
    Copy and save the token endpoint value by clicking Copy.

    To retrieve your tenant ID use the value from above. You can also use the following command in a terminal connected with PAC CLI

    ```bash
    pac auth who
    ```
    To retrieve your Copilot Studio bot ID and name, use the following command in a terminal connected with PAC CLI

    ```bash
    pac copilot list
    ```

    
    ```json
    "BotService": {
      "BotName": "<Name of your CPS bot>",
      "BotId": "<Bot ID copied from CLI output>",
      "TenantId": "<Tenant copied from CLI output>",
      "TokenEndPoint": "<Token endpoint copied from channel panel>",
      "DirectLineBaseUri": "https://[<region>.]directline.botframework.com | "
    }
   ``` 
   Refer to [DirectLine SDK Base URL](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-direct-line-3-0-api-reference?view=azure-bot-service-4.0#base-uri) on instructions for the correct value of **DirectLineBaseUri**.
   The complete `appsettings.json` file in your root directory should resemble the following:
   
   ```bash
    {
      "MicrosoftAppType":"SingleTenant",
      "MicrosoftAppId": "aaa",
      "MicrosoftAppPassword": "bbb",
      "MicrosoftAppTenantId":"ccc",
      "BotService": {
        "BotName": "<name>",
        "BotId": "xxx",
        "TenantId": "yyy",
        "TokenEndPoint": "zzz",
        "DirectLineBaseUri": "https://[<region>.]directline.botframework.com"
      },
      "ConversationPool": {
        "TokenRefreshCheckIntervalInMinute": 10,
        "TokenRefreshIntervalInMinute": 30,
        "ConversationEndAfterIdleTimeInMinute": 30,
        "ConversationEndCheckIntervalInMinute": 10
      }
    }
   ```

- Build the bot prepare it and deploy. See file [deploy.azcli](deploy.azcli)

  ```bash
    #Build
    dotnet build -c release .\VoiceAgent.csproj
    #Prepare
    if(Test-Path .deployment){
        Remove-Item -Force .deployment
        Remove-Item -Force VoiceAgentSample.zip
    }
    az bot prepare-deploy --lang CSharp --code-dir . --proj-file-path .\VoiceAgent.csproj
    Compress-Archive * .\VoiceAgentSample.zip -force
    #Deploy
    az webapp deployment source config-zip --resource-group $ressourceGroup --name $webAppName --src .\VoiceAgent.zip
  ```

## Testing the bot using Bot Framework Emulator

[Bot Framework Emulator](https://github.com/microsoft/botframework-emulator) is a desktop application that allows bot developers to test and debug their bots on localhost or running remotely through a tunnel.

- Install the Bot Framework Emulator version 4.3.0 or greater from [here](https://github.com/Microsoft/BotFramework-Emulator/releases)

### Connect to the bot using Bot Framework Emulator

- Launch Bot Framework Emulator
- File -> Open Bot
- Enter a Bot URL of [http://localhost:3978/api/messages](http://localhost:3978/api/messages)

## Testing the voice channel

[Windows Voice Assistant Client](https://github.com/Azure-Samples/Cognitive-Services-Voice-Assistant/blob/main/clients/csharp-wpf/README.md#windows-voice-assistant-client) is a desktop application that allows testing of Direct Line Speech enabled bot endpoints
- Install the Voice Assistant Client

### Connect to your bot

- Launch voice assistant client
- Follow the [instructions on the Voice Assistant page](https://github.com/Azure-Samples/Cognitive-Services-Voice-Assistant/blob/main/clients/csharp-wpf/README.md#windows-voice-assistant-client)  to connect to your speech services resource 


## Further reading

- [Bot Framework Documentation](https://docs.botframework.com)
- [Bot Basics](https://docs.microsoft.com/azure/bot-service/bot-builder-basics?view=azure-bot-service-4.0)
- [Activity processing](https://docs.microsoft.com/en-us/azure/bot-service/bot-builder-concept-activity-processing?view=azure-bot-service-4.0)
- [Azure Bot Service Introduction](https://docs.microsoft.com/azure/bot-service/bot-service-overview-introduction?view=azure-bot-service-4.0)
- [Azure Bot Service Documentation](https://docs.microsoft.com/azure/bot-service/?view=azure-bot-service-4.0)
- [.NET Core CLI tools](https://docs.microsoft.com/en-us/dotnet/core/tools/?tabs=netcore2x)
- [Azure CLI](https://docs.microsoft.com/cli/azure/?view=azure-cli-latest)
- [Azure Portal](https://portal.azure.com)
- [Language Understanding using LUIS](https://docs.microsoft.com/en-us/azure/cognitive-services/luis/)
- [Channels and Bot Connector Service](https://docs.microsoft.com/en-us/azure/bot-service/bot-concepts?view=azure-bot-service-4.0)
- [Restify](https://www.npmjs.com/package/restify)
- [dotenv](https://www.npmjs.com/package/dotenv)


## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
