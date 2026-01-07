using Azure.Communication.CallAutomation;
using Azure.Messaging;
using Azure.Messaging.EventGrid;
using Azure.Messaging.EventGrid.SystemEvents;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using JsonException = Newtonsoft.Json.JsonException;
using System.Net.Http.Headers;
using CallAutomation_MCS_Sample;
using System.Collections.Concurrent;
using System.Text.RegularExpressions;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Logging.AddConsole();
builder.Logging.SetMinimumLevel(LogLevel.Information);


//Get ACS Connection String from appsettings.json
var acsConnectionString = builder.Configuration.GetValue<string>("AcsConnectionString");
ArgumentException.ThrowIfNullOrEmpty(acsConnectionString);

//Call Automation Client
var client = new CallAutomationClient(connectionString: acsConnectionString);

//Get the Cognitive Services endpoint from appsettings.json
var cognitiveServicesEndpoint = builder.Configuration.GetValue<string>("CognitiveServiceEndpoint");
ArgumentException.ThrowIfNullOrEmpty(cognitiveServicesEndpoint);

//Get Agent Phone number from appsettings.json
var agentPhonenumber = builder.Configuration.GetValue<string>("AgentPhoneNumber");
ArgumentException.ThrowIfNullOrEmpty(agentPhonenumber);

// Get Direct Line Secret from appsettings.json
var directLineSecret = builder.Configuration.GetValue<string>("DirectLineSecret");
ArgumentException.ThrowIfNullOrEmpty(directLineSecret);
// Get voice name from appsettings.json
var voiceName = builder.Configuration.GetValue<string>("VoiceName") ?? "en-US-AvaMultilingualNeural";
ArgumentException.ThrowIfNullOrEmpty(voiceName);

//Get language  from appsettings.json
var ssmlLanguage = builder.Configuration.GetValue<string>("VoiceLanguage") ?? "en-US";

// Create an HTTP client to communicate with the Direct Line service
HttpClient httpClient = new HttpClient();
httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", directLineSecret);

ConcurrentDictionary<string, CallContext> CallStore = new();
var callerId = "";

var app = builder.Build();
// Get dev tunnel URL from launch.json if debugging locally or switch to productive URL from appsettingss
var baseUri = Environment.GetEnvironmentVariable("VS_TUNNEL_URL")?.TrimEnd('/');
if (string.IsNullOrEmpty(baseUri))
{
    baseUri = builder.Configuration["BaseUri"];
}
app.Logger.LogInformation($"\n>> Using base URI: {baseUri}\n");

// Safer URL parsing
var baseWssUri = baseUri?.Replace("https://", "").Replace("http://", "");
app.Logger.LogInformation($"\n>>WebSocket will use: wss://{baseWssUri}/ws\n");

app.MapGet("/", () =>
{
    app.Logger.LogInformation("GET CALLED -- Hello ACS CallAutomation - MCS Sample!");
    return "Hello ACS CallAutomation - MCS Sample!";
});

app.MapPost("/api/incomingCall", async (
    [FromBody] EventGridEvent[] eventGridEvents,
    ILogger<Program> logger) =>
{

    foreach (var eventGridEvent in eventGridEvents)
    {
        logger.LogInformation($"Incoming Call event received : {JsonConvert.SerializeObject(eventGridEvent)}");
        // Handle system events
        if (eventGridEvent.TryGetSystemEventData(out object eventData))
        {
            // Handle the subscription validation event.
            if (eventData is SubscriptionValidationEventData subscriptionValidationEventData)
            {
                var responseData = new SubscriptionValidationResponse
                {
                    ValidationResponse = subscriptionValidationEventData.ValidationCode
                };
                return Results.Ok(responseData);
            }
        }

        var jsonObject = JsonNode.Parse(eventGridEvent.Data).AsObject();
        //Safely get the call context
        var incomingCallContext = (string?)JsonNode.Parse(eventGridEvent.Data)?.AsObject()?["incomingCallContext"] ?? string.Empty;
        if (string.IsNullOrEmpty(incomingCallContext))
        {
            logger.LogWarning("Incoming call event missing 'incomingCallContext'. Event data: {EventData}", eventGridEvent.Data);
            continue;
        }
        //This URL will be called by ACS on every event (ParticipantUpdated, RecognizeComplete,..)
        var callbackUri = new Uri(baseUri + $"/api/calls/{Guid.NewGuid()}");

        // Set the call answer options to use websockets streaming and call /ws as soon as transcription starts
        var answerCallOptions = new AnswerCallOptions(incomingCallContext, callbackUri)
        {
            CallIntelligenceOptions = new CallIntelligenceOptions()
            {
                CognitiveServicesEndpoint = new Uri(cognitiveServicesEndpoint)
            },
            TranscriptionOptions = new TranscriptionOptions(ssmlLanguage)
            {
                TransportUri = new Uri($"wss://{baseWssUri}/ws"),
                TranscriptionTransport = StreamingTransport.Websocket,
                EnableIntermediateResults = true //Ensures partial transcriptions are sent immediately
            }
        };

        try
        {
            //Answer the call
            AnswerCallResult answerCallResult = await client.AnswerCallAsync(answerCallOptions);

            var correlationId = answerCallResult?.CallConnectionProperties.CorrelationId;
            logger.LogInformation($"\n>> Call answered: Correlation Id: {correlationId}, Source caller ID: {answerCallResult?.CallConnectionProperties.SourceCallerIdNumber}\n");
            logger.LogInformation($"\n>> Media streaming will use: {answerCallOptions?.TranscriptionOptions.TransportUri} \n");
            //Store the calls correlation id in the call store
            if (correlationId != null)
            {
                CallStore[correlationId] = new CallContext()
                {
                    CorrelationId = correlationId
                };
            }
        }
        catch (Exception ex)
        {
            logger.LogError($"Answer call exception : {ex.StackTrace}");
        }
    }
    return Results.Ok();
});

///
/// Handles call events
/// 
app.MapPost("/api/calls/{contextId}", async (
    [FromBody] CloudEvent[] cloudEvents,
    [FromRoute] string contextId,
    ILogger<Program> logger) =>
{
    foreach (var cloudEvent in cloudEvents)
    {
        CallAutomationEventBase @event = CallAutomationEventParser.Parse(cloudEvent);
        logger.LogInformation($"\n== Event received:  {@event.GetType().Name}\n");

        var callConnection = client.GetCallConnection(@event.CallConnectionId);
        var callMedia = callConnection?.GetCallMedia();
        var correlationId = @event.CorrelationId;

        if (callConnection == null || callMedia == null)
        {
            return Results.BadRequest($"\nCall objects failed to get for connection id {@event.CallConnectionId}.\n");
        }

        if (@event is CallConnected callConnected)
        {
            //Start MCS agent conversation as soon as call is connected
            var conversation = await StartConversationAsync();
            var conversationId = conversation.ConversationId;
            if (CallStore.ContainsKey(correlationId))
            {
                CallStore[correlationId].ConversationId = conversationId;
            }

            Console.WriteLine(">> Conversation started. Type 'exit' to stop.");
            Console.WriteLine($"Conversation ID: {conversationId} StreamUrl: {conversation.StreamUrl}");

            // Start listening for bot responses asynchronously
            var cts = new CancellationTokenSource();
            Task.Run(() => ListenToBotWebSocketAsync(conversation.StreamUrl, callConnection, cts.Token));

            //Start transcription to receive the websocket streamfor transcription of user utterances asynchronously
            await callMedia.StartTranscriptionAsync();
            // Send initial message to trigger welcome topic.
            await SendMessageAsync(conversationId, "Hi");
        }

        if (@event is ParticipantsUpdated participantsUpdated)
        {
            // Safely obtain callerId
            var participants = participantsUpdated.Participants;
            callerId = participants?.FirstOrDefault()?.Identifier?.RawId ?? string.Empty;
            logger.LogInformation($">> Participants updated: User CALLERID: {callerId}");
        }

        if (@event is SendDtmfTonesCompleted sendDtmfTonesCompleted)
        {
            logger.LogInformation($"Send DTMF tones completed");
        }
        
        if (@event is RecognizeCompleted recognizeCompleted)
        {
            if (recognizeCompleted.RecognizeResult is DtmfResult dtmfResult)
            {
                var dtmfInput = string.Join("", dtmfResult.Tones.Select(t => t.ToString().Replace("Tone", "")));
                logger.LogInformation($">> DTMF Recognition completed: User pressed: {dtmfInput}");
                
                // Get conversation ID and send DTMF input to bot
                if (CallStore.ContainsKey(correlationId))
                {
                    var conversationId = CallStore[correlationId].ConversationId;
                    if (!string.IsNullOrEmpty(conversationId))
                    {
                        await SendMessageAsync(conversationId, $"DTMF: {dtmfInput}");
                    }
                }
            }
            else if (recognizeCompleted.RecognizeResult is SpeechResult speechResult)
            {
                logger.LogInformation($">> Speech Recognition completed: User said: {speechResult.Speech}");

            }
        }
        
        if (@event is PlayFailed)
        {
            logger.LogInformation("Play Failed");
        }

        if (@event is PlayCompleted)
        {
            logger.LogInformation("Play Completed");

        }

        if (@event is TranscriptionStarted transcriptionStarted)
        {
            app.Logger.LogInformation($"Transcription started: {transcriptionStarted.OperationContext}");
        }

        if (@event is TranscriptionStopped transcriptionStopped)
        {
            logger.LogInformation($"Transcription stopped: {transcriptionStopped.OperationContext}");
        }

        if (@event is CallDisconnected callDisconnected)
        {
            logger.LogInformation("Call Disconnected");
            _ = CallStore.TryRemove(@event.CorrelationId, out CallContext context);

        }
    }
    return Results.Ok();
}).Produces(StatusCodes.Status200OK);

// setup web socket for stream in
app.UseWebSockets();
app.Use(async (context, next) =>
{
    if (context.Request.Path == "/ws")
    {
        if (context.WebSockets.IsWebSocketRequest)
        {
            // Extract correlation ID and call connection ID
            var correlationId = context.Request.Headers["x-ms-call-correlation-id"].FirstOrDefault();
            var callConnectionId = context.Request.Headers["x-ms-call-connection-id"].FirstOrDefault();
            var callMedia = callConnectionId != null ? client.GetCallConnection(callConnectionId)?.GetCallMedia() : null;
            // Log the extracted values
            Console.WriteLine($"****************************** Correlation ID: {correlationId}");
            Console.WriteLine($"****************************** Call Connection ID: {callConnectionId}");
            var conversationId = CallStore[correlationId].ConversationId;

            using var webSocket = await context.WebSockets.AcceptWebSocketAsync();
            try
            {
                string partialData = "";

                while (webSocket.State == WebSocketState.Open || webSocket.State == WebSocketState.CloseSent)
                {
                    byte[] receiveBuffer = new byte[4096];
                    var cancellationToken = new CancellationTokenSource(TimeSpan.FromSeconds(1200)).Token;
                    WebSocketReceiveResult receiveResult = await webSocket.ReceiveAsync(new ArraySegment<byte>(receiveBuffer), cancellationToken);

                    if (receiveResult.MessageType != WebSocketMessageType.Close)
                    {
                        string data = Encoding.UTF8.GetString(receiveBuffer).TrimEnd('\0');

                        try
                        {
                            if (receiveResult.EndOfMessage)
                            {
                                data = partialData + data;
                                partialData = "";

                                if (data != null)
                                {
                                    // Print audio sream: Overwrite previous console line with latest message (no extra new lines)
                                    try
                                    {
                                        var msg = $"[{DateTime.UtcNow:HH:mm:ss}] {data}";
                                        lock (Console.Out)
                                        {
                                            if (Console.IsOutputRedirected)
                                            {
                                                // When output is redirected (no interactive console), write a single line
                                                Console.WriteLine(msg);
                                            }
                                            else
                                            {
                                                // Ensure we clear any previous longer message by padding/truncating to console width
                                                int width = Console.WindowWidth;
                                                string output = msg.Length >= width ? msg.Substring(0, Math.Max(0, width - 1)) : msg.PadRight(Math.Max(0, width - 1));
                                                Console.SetCursorPosition(0, Console.CursorTop);
                                                Console.Write(output);
                                            }
                                        }
                                    }
                                    catch
                                    {
                                        // Ignore console-related errors in non-console environments
                                    }

                                    if (data.Contains("Intermediate"))
                                    {
                                        Console.WriteLine($"\n Canceling prompt");
                                        if (callMedia != null)
                                            await callMedia.CancelAllMediaOperationsAsync();
                                    }
                                    else
                                    {
                                        var streamingData = StreamingData.Parse(data);
                                        if (streamingData is TranscriptionMetadata transcriptionMetadata)
                                        {
                                            callMedia = client.GetCallConnection(transcriptionMetadata.CallConnectionId)?.GetCallMedia();
                                        }
                                        if (streamingData is TranscriptionData transcriptionData)
                                        {
                                            Console.WriteLine($"\n [{DateTime.UtcNow}] {transcriptionData.Text}");
                                            
                                            if (transcriptionData.ResultState == TranscriptionResultState.Final)
                                            {
                                                if (conversationId == null) conversationId = CallStore[correlationId].ConversationId;

                                                if (!string.IsNullOrEmpty(conversationId))
                                                {
                                                    await SendMessageAsync(conversationId, transcriptionData.Text);
                                                }
                                                else
                                                {
                                                    Console.WriteLine($"\n Conversation Id is null");

                                                }
                                            }
                                        }

                                    }
                                }

                            }
                            else
                            {
                                partialData = partialData + data;
                            }
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"Exception 1 -> {ex}");
                        }
                    }
                }
                //transcriptFileStream?.Close();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Exception 2 -> {ex}");
            }
            finally
            {

            }
        }
        else
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
        }
    }
    else
    {
        await next(context);
    }
});


async Task<Conversation> StartConversationAsync()
{
    var response = await httpClient.PostAsync("https://directline.botframework.com/v3/directline/conversations", null);
    response.EnsureSuccessStatusCode();
    var content = await response.Content.ReadAsStringAsync();
    return JsonConvert.DeserializeObject<Conversation>(content);
}

async Task ListenToBotWebSocketAsync(string streamUrl, CallConnection callConnection, CancellationToken cancellationToken)
{
    if (string.IsNullOrEmpty(streamUrl))
    {
        Console.WriteLine("WebSocket streaming is not enabled for this MCS bot.");
        return;
    }

    using (var webSocket = new ClientWebSocket())
    {
        try
        {
            await webSocket.ConnectAsync(new Uri(streamUrl), cancellationToken);

            var buffer = new byte[4096]; // Set the buffer size to 4096 bytes
            var messageBuilder = new StringBuilder();

            while (webSocket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
            {
                messageBuilder.Clear(); // Reset buffer for each new message
                WebSocketReceiveResult result;
                do
                {
                    result = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);
                    messageBuilder.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));

                } while (!result.EndOfMessage); // Continue until we've received the full message

                string rawMessage = messageBuilder.ToString();
                var botActivity = ExtractLatestBotActivity(rawMessage);

                if (botActivity.Type == "message")
                {
                    Console.WriteLine($"\nPlaying Bot Response: {botActivity.Text}\n");
                    await PlayToAllAsync(callConnection.GetCallMedia(), botActivity.Text);

                }
                else if (botActivity.Type == "endOfConversation")
                {
                    Console.WriteLine($"\nEnd of Conversation\n");
                    await callConnection.HangUpAsync(true);
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"WebSocket error: {ex.Message}");
        }
        finally
        {
            if (webSocket.State == WebSocketState.Open)
            {
                await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", cancellationToken);
            }
        }
    }
}

async Task SendMessageAsync(string conversationId, string message)
{
    var messagePayload = new
    {
        type = "message",
        from = new { id = "user1" },
        text = message,
        // Add channelData to help bot distinguish DTMF from speech
        channelData = message.StartsWith("DTMF:") ? new { inputType = "dtmf" } : new { inputType = "speech" }
    };
    string messageJson = JsonConvert.SerializeObject(messagePayload);
    StringContent content = new StringContent(messageJson, Encoding.UTF8, "application/json");

    var response = await httpClient.PostAsync($"https://directline.botframework.com/v3/directline/conversations/{conversationId}/activities", content);
    response.EnsureSuccessStatusCode();
}

static BotActivity ExtractLatestBotActivity(string rawMessage)
{
    try
    {
        using var doc = JsonDocument.Parse(rawMessage);

        Console.WriteLine($"Raw Message: {rawMessage}");

        if (doc.RootElement.TryGetProperty("activities", out var activities) && activities.ValueKind == JsonValueKind.Array)
        {
            // Iterate in reverse order to get the latest message
            for (int i = activities.GetArrayLength() - 1; i >= 0; i--)
            {
                var activity = activities[i];

                if (activity.TryGetProperty("type", out var type))
                {
                    if (type.GetString() == "message")
                    {
                        if (activity.TryGetProperty("from", out var from) &&
                            from.TryGetProperty("id", out var fromId) &&
                            fromId.GetString() != "user1") // Ensure message is from bot
                        {
                            if (activity.TryGetProperty("speak", out var speak))
                            {
                                //Console.WriteLine($"Voice content: {speak}");
                                return new BotActivity()
                                {
                                    Type = "message",
                                    Text = RemoveReferences(speak.GetString())
                                };
                            }

                            if (activity.TryGetProperty("text", out var text))
                            {
                                return new BotActivity()
                                {
                                    Type = "message",
                                    Text = RemoveReferences(text.GetString())
                                };
                            }
                        }
                    }
                    else if (type.GetString() == "endOfConversation")
                    {
                        return new BotActivity()
                        {
                            Type = "endOfConversation"
                        };
                    }

                }
            }
        }
    }
    catch (JsonException)
    {
        Console.WriteLine("Warning: Received unexpected JSON format.");
    }
    return new BotActivity()
    {
        Type = "Error",
        Text = "Sorry, Something went wrong"
    };
}

static string RemoveReferences(string input)
{
    // Remove inline references like [1], [2], etc.
    string withoutInlineRefs = Regex.Replace(input, @"\[\d+\]", "");

    // Remove reference list at the end (lines starting with [number]:)
    string withoutRefList = Regex.Replace(withoutInlineRefs, @"\n\[\d+\]:.*(\n|$)", "");

    return withoutRefList.Trim();
}



async Task PlayToAllAsync(CallMedia callConnectionMedia, string message)
{
    
    var ssmlPlaySource = new SsmlSource($"<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\" xml:lang=\"{ssmlLanguage}\"><voice name=\"{voiceName}\">{message}</voice></speak>");

    var playOptions = new PlayToAllOptions(ssmlPlaySource)
    {
        OperationContext = "Testing"
    };

    await callConnectionMedia.PlayToAllAsync(playOptions);
}


// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment() || app.Environment.IsProduction())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseAuthorization();
app.MapControllers();
app.Run();

if (app.Environment.IsDevelopment())
{
    app.Logger.LogInformation("Running in DEVELOPMENT mode");
    // Development-specific logic
}
else if (app.Environment.IsProduction())
{
    app.Logger.LogInformation("Running in PRODUCTION mode");
    // Production-specific logic
}

app.Logger.LogInformation($"Current environment: {app.Environment.EnvironmentName}");
