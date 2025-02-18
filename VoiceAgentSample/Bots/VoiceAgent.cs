// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Bot.Builder;
using Bot = Microsoft.Bot.Schema;
using DirectLine = Microsoft.Bot.Connector.DirectLine;
using Microsoft.Bot.Connector.DirectLine;
using Microsoft.Bot.Builder.TraceExtensions;
using System.Linq;

namespace VoiceAgentSample
{
    public class VoiceAgent : ActivityHandler
    {

        private const int WaitForBotResponseMaxMilSec = 5 * 1000;
        private const int PollForBotResponseIntervalMilSec = 1000;
        private static ConversationManager s_conversationManager = ConversationManager.Instance;
        private ResponseConverter _responseConverter;
        private IBotService _botService;

        public string DirectLineBaseUri
        {
            get { return ((BotService)_botService).DirectLineBaseUri; }
        }

        public VoiceAgent(IBotService botService, ResponseConverter responseConverter)
        {
            _botService = botService;
            _responseConverter = responseConverter;
        }


        protected override async Task OnConversationUpdateActivityAsync(ITurnContext<Bot.IConversationUpdateActivity> turnContext, CancellationToken cancellationToken)
        {
            try
            {
                //Start a new conversation with Copilot Studio Agent
                var newConversation = await s_conversationManager.GetOrCreateBotConversationAsync(turnContext.Activity.Conversation.Id, _botService);
                //Get OnConversationStart message from Copilot Studio Agent
                await turnContext.SendActivityAsync(MessageFactory.Text("Conversation created", "A new conversation has been created"), cancellationToken);
                using (var client = new DirectLine.DirectLineClient(new Uri(DirectLineBaseUri), new DirectLine.DirectLineClientCredentials(newConversation.Token)))
                {
                    // await turnContext.SendActivityAsync(MessageFactory.Text("[Sent start event to Copilot agent]"), cancellationToken);
                    await client.Conversations.PostActivityAsync(newConversation.ConversationtId, new DirectLine.Activity()
                    {
                        Type = ActivityTypes.Event,
                        Name = "StartConversation",
                        From = new ChannelAccount { Id = turnContext.Activity.Recipient.Id, Name = turnContext.Activity.Recipient.Name },
                        ChannelId = turnContext.Activity.ChannelId,
                        Conversation = new ConversationAccount { Id = turnContext.Activity.Conversation.Id },
                        Recipient = new ChannelAccount { Id = turnContext.Activity.Recipient.Id, Name = turnContext.Activity.Recipient.Name },
                    });
                    await GetCopilotStudioConversationStart(client, newConversation, turnContext);
                }

            }
            catch (Exception e)
            {
                throw new Exception($"ERROR in OnConversationUpdateActivityAsync: {e.Message}, {turnContext.Activity.Conversation.Id} {_botService}");
            }

        }

        /// <summary>
        /// Handles the message activity asynchronously.
        /// This method sends the message to the Copilot agent.
        /// It then waits for a response from the Copilot agent and sends it back to the user.
        /// </summary>
        /// <param name="turnContext"></param>
        /// <param name="cancellationToken"></param>
        /// <returns></returns>
        protected override async Task OnMessageActivityAsync(ITurnContext<Bot.IMessageActivity> turnContext, CancellationToken cancellationToken)
        {
            // var replyText = $"Echo: {turnContext.Activity.Text}";
            // await turnContext.SendActivityAsync(MessageFactory.Text(replyText, replyText), cancellationToken);

            var currentConversation = await s_conversationManager.GetOrCreateBotConversationAsync(turnContext.Activity.Conversation.Id, _botService);
            using (var client = new DirectLine.DirectLineClient(new Uri(DirectLineBaseUri), new DirectLine.DirectLineClientCredentials(currentConversation.Token)))
            {
                // Send user message using directlineClient
                await client.Conversations.PostActivityAsync(currentConversation.ConversationtId, new DirectLine.Activity()
                {
                    Type = ActivityTypes.Message,
                    From = new ChannelAccount { Id = turnContext.Activity.From.Id, Name = turnContext.Activity.From.Name },
                    Text = turnContext.Activity.Text,
                    TextFormat = turnContext.Activity.TextFormat,
                    Speak = turnContext.Activity.Speak,
                    Locale = turnContext.Activity.Locale
                });

                // await turnContext.TraceActivityAsync("SPEECHAGENT:", label: "Sent message to Copilot agent", valueType: "Text", value: turnContext.Activity.Text);
                // await turnContext.SendActivityAsync(MessageFactory.Text("[Sent message to Copilot agent]"), cancellationToken);
                await GetCopilotStudioAgentResponse(client, currentConversation, turnContext);
            }

            // // Update LastConversationUpdateTime for session management
            currentConversation.LastConversationUpdateTime = DateTime.Now;
        }

        /// <summary>
        /// Get Copilot Studio agent response to a user message
        /// </summary>
        /// <param name="client"></param>
        /// <param name="currentConversation"></param>
        /// <param name="turnContext"></param>
        /// <returns></returns>
        private async Task GetCopilotStudioAgentResponse(DirectLineClient client, RelayConversation currentConversation, ITurnContext<Bot.IMessageActivity> turnContext)
        {
            var retryMax = WaitForBotResponseMaxMilSec / PollForBotResponseIntervalMilSec;
            for (int retry = 0; retry < retryMax; retry++)
            {
                // Get bot response using directlineClient,
                // response contains whole conversation history including user & bot's message
                ActivitySet response = await client.Conversations.GetActivitiesAsync(currentConversation.ConversationtId, currentConversation.WaterMark);

                // Filter bot's reply message from response
                List<DirectLine.Activity> botResponses = response?.Activities?.Where(x =>
                      x.Type == DirectLine.ActivityTypes.Message &&
                        string.Equals(x.From.Name, _botService.GetBotName(), StringComparison.Ordinal)).ToList();
     
                await turnContext.TraceActivityAsync("SPEECHAGENT:", label: "Looking for copilot agent responses", valueType: "Text", value: turnContext.Activity.Text);
                if (botResponses?.Count() > 0)
                {
                    if (int.Parse(response?.Watermark ?? "0") <= int.Parse(currentConversation.WaterMark ?? "0"))
                    {
                        // means user sends new message, should break previous response poll
                        return;
                    }
                    
                    currentConversation.WaterMark = response.Watermark;
                    await turnContext.SendActivitiesAsync(_responseConverter.ConvertToBotSchemaActivities(botResponses).ToArray());
                }

                Thread.Sleep(PollForBotResponseIntervalMilSec);
            }
        }

        /// <summary>
        /// Get Copilot Studio agent response to a conversation start event (Should trigger a welcome message defined in Copilot Studio agent Conversation start topic)
        /// </summary>
        /// <param name="client"></param>
        /// <param name="currentConversation"></param>
        /// <param name="turnContext"></param>
        /// <returns></returns>
        private async Task GetCopilotStudioConversationStart(DirectLineClient client, RelayConversation currentConversation, ITurnContext<Bot.IConversationUpdateActivity> turnContext)
        {
            var retryMax = WaitForBotResponseMaxMilSec / PollForBotResponseIntervalMilSec;
            for (int retry = 0; retry < retryMax; retry++)
            {
                // Get bot response using directlineClient,
                // response contains whole conversation history including user & bot's message
                ActivitySet response = await client.Conversations.GetActivitiesAsync(currentConversation.ConversationtId, currentConversation.WaterMark);

                // Filter bot's reply message from response
                List<DirectLine.Activity> botResponses = response?.Activities?.Where(x =>
                      x.Type == DirectLine.ActivityTypes.Message &&
                        string.Equals(x.From.Name, _botService.GetBotName(), StringComparison.Ordinal)).ToList();

                //await turnContext.TraceActivityAsync("SPEECHAGENT:", label: "Copilot agent responding", valueType: "Text", value: turnContext.Activity.TopicName);
                if (botResponses?.Count() > 0)
                {
                    if (int.Parse(response?.Watermark ?? "0") <= int.Parse(currentConversation.WaterMark ?? "0"))
                    {
                        // means user sends new message, should break previous response poll
                        return;
                    }
         
                    currentConversation.WaterMark = response.Watermark;
                    await turnContext.SendActivitiesAsync(_responseConverter.ConvertToBotSchemaActivities(botResponses).ToArray());
                }

                Thread.Sleep(PollForBotResponseIntervalMilSec);
            }
        }


        // protected override async Task OnMembersAddedAsync(IList<Bot.ChannelAccount> membersAdded, ITurnContext<Bot.IConversationUpdateActivity> turnContext, CancellationToken cancellationToken)
        // {
        //     var welcomeText = "Hello and welcome!";
        //     foreach (var member in membersAdded)
        //     {
        //         if (member.Id != turnContext.Activity.Recipient.Id)
        //         {
        //             await turnContext.SendActivityAsync(MessageFactory.Text(welcomeText, welcomeText), cancellationToken);
        //         }
        //     }
        // }

    }
}
