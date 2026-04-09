/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import {
  CopilotStudioClient,
  CopilotStudioWebChat,
} from "@microsoft/agents-copilotstudio-client";

import { acquireToken } from "./acquireToken.js";
import { settings } from "./settings.js";

try {
  const token = await acquireToken(settings);
  const client = new CopilotStudioClient(settings, token);

  // Extract URL parameters
  const urlParams = new URLSearchParams(window.location.search);

  // Build context object from URL parameters
  const context = {};
  for (const [key, value] of urlParams.entries()) {
    console.log(`Passing URL parameter: ${key} = ${value}`);
    context[key] = value;
  }

  const connection = CopilotStudioWebChat.createConnection(client, {
    typingIndicator: true,
  });

  
  connection.connectionStatus$.subscribe((status) => {
    switch (status) {
      case 0:
        console.log("Disconnected");
        break;
      case 1:
        console.log("Connecting...");
        break;
      case 2:
        console.log("Connected and ready");
        break;
    }
  });

  // Listen for incoming activities
  connection.activity$.subscribe((activity) => {
    console.log("Received activity:", activity);
  });

  // Make webchat visible and render
  const webchatDiv = document.getElementById("webchat");
  webchatDiv.style.display = "block";

  window.WebChat.renderWebChat(
    {
      directLine: connection,
    },
    webchatDiv,
  );

  // Add toggle functionality
  const chatToggle = document.getElementById("chat-toggle");
  chatToggle.addEventListener("click", () => {
    if (webchatDiv.style.display === "none") {
      webchatDiv.style.display = "block";
    } else {
      webchatDiv.style.display = "none";
    }
  });
let eventSent = false;
    // Send event when connected
      if (urlParams.has("leadId") && !eventSent) {
        eventSent = true;
        const leadId = urlParams.get("leadId");
        console.log("Sending lead context to MCS: ", leadId);

        const eventActivity = {
          type: "event",
          name: "setLeadContext",
          value: { leadId: leadId },
          conversation: { id: connection.id },
        };
        
        console.log("Sending event activity: ", eventActivity);
        (async () => {
          for await (const reply of client.sendActivityStreaming(eventActivity)) {
            console.log(reply.type, reply.text || reply.value);
          }
        })();
      } else {
        console.log("No leadId parameter found in URL.");
    }


  // #################
  // Auto-send initial message if leadId is present. This waits until WebChat is initialized and the inserts a message and clicks send
  // #################
  setTimeout(() => {
    const inputElement = document.querySelector(
      '[data-id="webchat-sendbox-input"]',
    );
    if (inputElement) {
      inputElement.focus();
      if (urlParams.has("leadId")) {
        const initialMessage = "Lade Antrag: " + urlParams.get("leadId");
        inputElement.value = initialMessage;
        console.log("Initial message set in input:", initialMessage);
        // Wait 250ms then send Enter key
        setTimeout(() => {
          const enterEvent = new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
          });
          inputElement.dispatchEvent(enterEvent);
          console.log("Enter key sent");
        }, 250);
      }
    }
  }, 1000);
} catch (err) {
  console.error("Failed to initialize:", err);
}
