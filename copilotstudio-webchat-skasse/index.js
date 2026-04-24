/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import {
  directLineTokenEndpoint,
  directLineSecret,
} from "./settings.js";

async function initializeChat() {
  try {
    // Get leadId from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const leadId =
      urlParams.get("leadid") ||
      urlParams.get("leadId") ||
      urlParams.get("LeadId") ||
      urlParams.get("LEADID") ||
      ""; // Default to empty string if not provided otherwise use provided leadId from url (case insensitive)
    console.log("Using LeadId:", leadId);
    let directLine;
    let data;

    if (directLineTokenEndpoint) {
      // Use token endpoint from MCS to get a token
      console.log("Fetching token from endpoint...");
      const response = await fetch(directLineTokenEndpoint);

      if (!response.ok) {
        console.error(
          `Token endpoint failed with status ${response.status}: ${response.statusText}`,
        );
        const errorText = await response.text();
        console.error("Error details:", errorText);
        throw new Error(
          `Failed to get token: ${response.status} ${response.statusText}`,
        );
      }

      data = await response.json();
      console.log("Direct Line token received successfully");
    }

    // As soon as DL connection is established, create store to handle context variables and inject a local welcome message
    const store = window.WebChat.createStore(
      {},
      ({ dispatch }) =>
        (next) =>
        (action) => {
          // Handle incoming activities from the bot to the client
          if (action.type === "DIRECT_LINE/INCOMING_ACTIVITY") {
            const activity = action.payload.activity;
            if (activity.type === "trace") { // Don't process trace activities
              console.log("Trace activity filtered:", activity);
              return; 
            } else if (activity.type === "event") { //Handle custom incoming events using central event handler
              console.log("EVENT received:", activity.name, activity.value);
              handleIncomingEvent(activity.name, activity.value);
            }
          }

          if (action.type === "DIRECT_LINE/CONNECT_FULFILLED") {
            console.log("Direct Line connected");
            // Send a proactive message with the leadId to MCS
            console.log("Sending proactive message with leadId:", leadId);
            dispatch({
              type: "DIRECT_LINE/POST_ACTIVITY",
              meta: { method: "keyboard" },
              payload: {
                activity: {
                  type: "message",
                  text: `Lade Antrag: ${leadId}`,
                  from: { id: "user" },
                },
              },
            });
            // Inject a mocked welcome message for the user
            dispatch({
              type: "DIRECT_LINE/INCOMING_ACTIVITY",
              payload: {
                activity: {
                  type: "message",
                  id: "welcome-" + Date.now(),
                  timestamp: new Date().toISOString(),
                  from: { id: "bot", role: "bot" },
                  text: leadId
                    ? `Willkommen! Lassen sie uns ihren Antrag gemeinsam fertig stellen. Ich lade ihren Antrag ${leadId} ...`
                    : "Willkommen beim Raiffeisen Chatbot! Wie kann ich Ihnen heute helfen?",
                },
              },
            });

            // Send event to set lead context if a lead id is provided
            console.log("Sending lead context:", leadId);
            dispatch({
              type: "DIRECT_LINE/POST_ACTIVITY",
              meta: { method: "button" },
              payload: {
                activity: {
                  type: "event",
                  name: "setLeadContext",
                  from: { id: "user1" },
                  value: leadId == "" ? "no-leadId-provided" : leadId,
                },
              },
            });
          }
          return next(action);
        },
    );
    // Create Direct Line connection
    directLine = window.WebChat.createDirectLine({ token: data.token });

    window.WebChat.renderWebChat(
      {
        directLine,
        store,
        sendAttachmentOn: "upload", // Send files immediately after upload (do not wait for send to be pressed)
        styleOptions: {
          // Raiffeisen Landesbank Steiermark Branding
          // Primary brand colors
          accent: "#014740", // SKasse Blue
          subtle: "#F5F5F5", // Light gray background

          // Bot and user message styling
          bubbleBackground: "#FFFFFF",
          bubbleBorder: "solid 1px #D0D0D0",
          bubbleBoxShadow: "0 2px 4px rgba(0, 0, 0, 0.08)",
          bubbleFromUserBackground: "#dce8fa",
          bubbleFromUserBorder: "solid 1px #D0D0D0",
          bubbleFromUserTextColor: "#000000",
          bubbleBorderRadius: 8,
          bubbleFromUserBorderRadius: 8,

          // Font styling
          primaryFont:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          fontSizeSmall: "10px",

          // Bot avatar - custom image
          botAvatarImage: "img/sbaulogo.png",
          botAvatarBackgroundColor: "#0D1B3E",
          botAvatarInitials: "SW",

          // User avatar
          userAvatarBackgroundColor: "#014740",
          userAvatarInitials: "RS",

          // Send box styling
          sendBoxBackground: "#FFFFFF",
          sendBoxButtonColor: "#000000",
          sendBoxButtonColorOnHover: "#2356C3",
          sendBoxTextColor: "#000000",
          sendBoxBorderTop: "solid 1px #E0E0E0",
          sendBoxHeight: 50,

          // Suggested actions
          suggestedActionBackgroundColor: "#2356C3",
          suggestedActionBorder: "solid 2px #2356C3",
          suggestedActionBorderRadius: 20,
          suggestedActionTextColor: "#000000",

          // Scrollbar
          transcriptOverlayButtonBackground: "#2356C3",
          transcriptOverlayButtonBackgroundOnHover: "#2356C3",

          // Hide upload button
          hideUploadButton: false, // Show the upload button
        },
      },
      document.getElementById("webchat"),
    );

    // Don't auto-focus since chat is hidden initially
    // document.querySelector("#webchat > *").focus();
  } catch (err) {
    console.error("Failed to initialize:", err);

    // Display error message in the chat container
    const webchatElement = document.getElementById("webchat");
    if (webchatElement) {
      webchatElement.innerHTML = `
        <div style="padding: 20px; color: #d32f2f; background-color: #ffebee; border-radius: 4px; margin: 20px;">
          <h3 style="margin-top: 0;">Verbindungsfehler</h3>
          <p><strong>Der Chat konnte nicht gestartet werden.</strong></p>
          <p>Fehlerdetails: ${err.message}</p>
          <p style="font-size: 0.9em; margin-top: 10px;">
            Mögliche Ursachen:
            <ul>
              <li>Ungültiges oder abgelaufenes Token/Secret</li>
              <li>Bot ist nicht verfügbar oder wurde deaktiviert</li>
              <li>Netzwerkprobleme oder CORS-Einschränkungen</li>
            </ul>
          </p>
          <p style="font-size: 0.9em;">Bitte prüfen Sie die Browserkonsole für weitere Details.</p>
        </div>
      `;
    }
  }
}

// Chat toggle functionality
function setupChatToggle() {
  const chatToggle = document.getElementById("chat-toggle");
  const webchat = document.getElementById("webchat");

  // Check if leadid URL parameter is present
  const urlParams = new URLSearchParams(window.location.search);
  const hasLeadId =
    urlParams.has("leadid") ||
    urlParams.has("leadId") ||
    urlParams.has("LeadId") ||
    urlParams.has("LEADID");

  if (hasLeadId) console.log("Got lead ID. Opening chat");
  let isOpen = hasLeadId; // Auto-open if leadid is present

  // Set initial state if auto-opening
  if (isOpen) {
    webchat.style.display = "block";
    chatToggle.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>
      </svg>
    `;
    chatToggle.setAttribute("aria-label", "Chat schließen");

    // Focus on chat when auto-opened
    setTimeout(() => {
      const chatInput = document.querySelector("#webchat input[type='text']");
      if (chatInput) chatInput.focus();
    }, 300);
  }

  chatToggle.addEventListener("click", () => {
    isOpen = !isOpen;

    if (isOpen) {
      webchat.style.display = "block";
      chatToggle.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>
        </svg>
      `;
      chatToggle.setAttribute("aria-label", "Chat schließen");

      // Focus on chat when opened
      setTimeout(() => {
        const chatInput = document.querySelector("#webchat input[type='text']");
        if (chatInput) chatInput.focus();
      }, 300);
    } else {
      webchat.style.display = "none";
      chatToggle.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" fill="currentColor"/>
        </svg>
      `;
      chatToggle.setAttribute("aria-label", "Chat öffnen");
    }
  });
}

// Initialize chat and setup toggle
initializeChat();
setupChatToggle();

// Upload button event handler
document.addEventListener("DOMContentLoaded", () => {
  // Use event delegation since the element might be added dynamically
  document.addEventListener("click", (event) => {
    if (event.target.closest(".webchat__attachment-icon__icon")) {
      console.log("Upload button clicked");
      const chatInput = document.querySelector("#webchat input[type='text']");
      if (chatInput) {
        // Use native setter to bypass React's controlled component
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        ).set;
        nativeInputValueSetter.call(chatInput, "Hier der Ausweis");

        // Dispatch input event to notify React
        const inputEvent = new Event("input", { bubbles: true });
        chatInput.dispatchEvent(inputEvent);
      }
    }
  });
});

//##################################
// Central event handler for incoming events from bot to client
//##################################

function handleIncomingEvent(eventName, eventValue) {
  console.log(`Handling event: ${eventName}`, eventValue);

  // Handle different event types
  switch (eventName) {
    case "redirectToDetailsPage": //Open a new tab with provided URL if the event is to redirect to details page
      console.log("EVENT: Redirecting to details page:", eventValue);
      updateHeroContent("Vielen Dank Rafaela", "Wir freuen uns auf den Termin mit Ihnen.");
      break;
    default:
      console.log("Unhandled custom event:", eventName, eventValue);
  }
}

//##################################
// Update hero content dynamically
//##################################

function updateHeroContent(heading, paragraph) {
  const heroContent = document.querySelector('.hero-content');
  if (!heroContent) {
    console.error("Hero content element not found");
    return;
  }

  const h2 = heroContent.querySelector('h2');
  const p = heroContent.querySelector('p');

  if (h2) {
    h2.textContent = heading;
  }

  if (p) {
    p.textContent = paragraph;
  }
}

// Example usage:
// updateHeroContent("Vielen Dank Rafaela", "WIr freuen uns auf den Termin mit ihnen");