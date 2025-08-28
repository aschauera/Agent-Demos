
# ACS Call Automation and Microsoft Copilot Studio (MCS) Bot Integration - Extended sample code

Original sample can be found here: https://github.com/Azure-Samples/communication-services-dotnet-quickstarts/tree/main/CallAutomation_MCS_Sample

This is a sample application that demonstrates the integration of **Azure Communication Services (ACS)** with **Microsoft Copilot Studio (MCS)** bot using the **Direct Line API**. It enables real-time transcription of calls and interaction with a MCS bot, with responses played back to the caller using SSML (Speech Synthesis Markup Language). This sample has been extended to fix bugs and missing code from the original repo and extended to fully support **Microsoft Copilot Studio** agent functionality.
Especially the missing transcription has been added as well as tweaks to speech recognition and multilinguael transcription and voice setup.

## Prerequisites

- **Azure Account**: Create an Azure account with an active subscription. For details, see [Create an account for free](https://azure.microsoft.com/free/).
- **Azure Communication Services Resource**: Create an ACS resource. For details, see [Create an Azure Communication Resource](https://docs.microsoft.com/azure/communication-services/quickstarts/create-communication-resource). Record your resource **connection string** for this sample.
- **Calling-Enabled Phone Number**: Obtain a phone number. For details, see [Get a phone number](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/telephony/get-phone-number?tabs=windows&pivots=platform-azp).
- **Azure Cognitive Services Resource**: Set up a Cognitive Services resource. For details, see [Create a Cognitive Services resource](https://learn.microsoft.com/en-us/azure/cognitive-services/cognitive-services-apis-create-account).
- **MCS Bot Framework**: Create a MCS bot and enable the **Direct Line channel**. Obtain the **Direct Line secret**.
- **Azure Dev Tunnels CLI**: Install and configure Azure Dev Tunnels. For details, see [Enable dev tunnel](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started?tabs=windows).

## Setup Instructions

Before running this sample, you'll need to setup the resources above with the following configuration updates:

##### 0. Prerequisites

Create the required resources in Azure - see [CreateAzureResources.azcli](/createresources.azcli) for the AZ CLI statements.

##### 1. Setup and host your Azure DevTunnel

[Azure DevTunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/overview) is an Azure service that enables you to share local web services hosted on the internet. Use the commands below to connect your local development environment to the public internet. This creates a tunnel with a persistent endpoint URL and which allows anonymous access. We will then use this endpoint to notify your application of calling events from the ACS Call Automation service.

```bash
devtunnel create --allow-anonymous
devtunnel port create -p 49412
devtunnel host
```

##### 2. Add the required API Keys and endpoints
Update the following values in the `appsettings.json` file or `Program.cs`:

- `AcsConnectionString`: The connection string for your Azure Communication Services resource.
- `CognitiveServiceEndpoint`: The endpoint for your Azure Cognitive Services resource.
- `AgentPhoneNumber`: The phone number associated with your ACS resource.
- `DirectLineSecret`: The Direct Line secret for your MCS bot.
- `BaseUri`: The DevTunnel URI (e.g., `https://{DevTunnelUri}`).
- `VoiceName`: see spx synthesize to find available voices.
- `VoiceLanguage`: locale (eg.: en-US, de-DE)

## Running the application

1. Azure DevTunnel: Ensure your AzureDevTunnel URI is active and points to the correct port of your localhost application
2. Run `dotnet run --urls "http://localhost:49412" ` to build and run the sample application on the port of the dev tunnel.
3. Register an EventGrid Webhook for the IncomingCall Event that points to your DevTunnel URI. Instructions [here](https://learn.microsoft.com/en-us/azure/communication-services/concepts/call-automation/incoming-call-notification).

## Debugging

The sample code contains a lot of logging to help debugging from a console.
To run in debug, create the following environment variables in the VSCode launch.json file (in /.vscode)

```json
            "env": {
                "ASPNETCORE_ENVIRONMENT": "Development",
                "ASPNETCORE_URLS": "http://localhost:49412",
                "VS_TUNNEL_URL": "https://<created by devtunnel host>",
                "DL_SECRET": "<MCS DL Secret>
            }
```

Once that's completed you should have a runnin and debuggable application. The best way to test this is to place a call to your ACS phone number and talk to your intelligent agent.

## How it works
The code sets up a POST handler at `/api/incomingCall`. This is also the POST endpoint that needs to be registered in the EventGrid for ACS.

```csharp
app.MapPost("/api/incomingCall", async (
    [FromBody] EventGridEvent[] eventGridEvents,
    ILogger<Program> logger) =>
{
```
After handling the incoming call the code sets up a callback for subsequent event handling at.

```csharp
app.MapPost("/api/calls/{contextId}", async (
    [FromBody] CloudEvent[] cloudEvents,
    [FromRoute] string contextId,
    ILogger<Program> logger) =>
{
```
Inside this handler all call related events are handled. Logging is present to see how events are triggered on the console.
The call

```csharp
Task.Run(() => ListenToBotWebSocketAsync(conversation.StreamUrl, callConnection, cts.Token));
```
Sets up the agent > user channel handling playing of bot messages.

To enable user (speech) > agent transcription is started using `.StartTranscriptionAsync()`. This ensures the /ws endpoint is called which handles inspection of the streaming websocket.

```csharp 
//Start transcription to receive the websocket streamfor transcription of user utterances asynchronously
await callMedia.StartTranscriptionAsync();
// Send initial message to trigger welcome topic.
await SendMessageAsync(conversationId, "Hi");
```
To enable intermediate results aka Barge-In via Speech, the code uses Websockets directly to inspect the incoming stream.
See line 266 ff
```csharp
app.Use(async (context, next) =>
{
    if (context.Request.Path == "/ws")
    {
        if (context.WebSockets.IsWebSocketRequest)
        {
            //Code continues and inspects websocket events
        }
```
This enables users to interrupt the bot playing its message and start talking immediately without having to wait for the agent to finish its message, thus enabling a more natural conversation.
