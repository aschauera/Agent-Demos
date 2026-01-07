
# Custom WebService Agent

## Overview
This is a demo implementation of a Copilot Studio Agent to demonstrate how to connect to *custom Line of Business Systems* and use leverage the systems as agentic tools.


## Features
- Custom Power Platform Connector to a custom Azure-deployed WebService
- Agent Tools in Copilot Studio to leverage the custom connector
- Custom file upload in Copilot Studio
- AI Prompts
- Instruction based LLM orchestration to demonstrate a Contract Validation process.

## Installation

### Power Platform components

- Navigate to make.powerautomate.com
- Select *Solutions* on the left navigation bar and *<- Import solutions* on the top bar.
- Select the [Solution file](ExpertAgents_1_0_0_1.zip) contained in this repository to import.

### Deploying the demo web service

- If you want to use the demo implementation of the LOB web service (aka contract validation web service), use the provided deployment script file [deploy-simple.ps1](../demowebservices/MockContractWebService/deploy-simple.ps1) to create all required Microsoft Azure components.

## Components
- [Solution File](ExpertAgents_1_0_0_1.zip). Contains all artefacts of the demo agent.
  - Contains a cloud flow that demonstrate how to process files uploaded from Copilot Studio using AI prompts.
  - Contains the Agent and tool definitions
  - Contains the custom connector

- [Custom Connector Swagger](Contract-Validation-Service.swagger.json). For reference. Contains the custom LOB system connector definition.
- [API Properties](./apiProperties.json). Contains the metadata for the custom connector.

## Configuration

If using the solution file no further configuration is required. It contains all components.

## Usage
If you choose to use the components individually, use the SWAGGER files and ```apiproperties.json``` to create the custom connector.

## 📝 License

See [LICENSE](./LICENSE) for details.
