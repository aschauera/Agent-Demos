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
                    ? `Willkommen bei bank99! Lass uns deinen Antrag gemeinsam fertigstellen. Ich lade deinen Antrag ${leadId} …`
                    : "Willkommen bei bank99! Wie kann ich dir bei deinem wohnkredit99 helfen?",
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
          // bank99 Branding
          // Primary yellow: #FFD900 | Dark: #0F1923
          accent: "#FFD900",
          subtle: "#FFFDE6",

          // Bot and user message styling
          bubbleBackground: "#FFFFFF",
          bubbleBorder: "solid 1px #E8E8E8",
          bubbleBoxShadow: "0 2px 6px rgba(15, 25, 35, 0.06)",
          bubbleFromUserBackground: "#FFD900",
          bubbleFromUserBorder: "solid 1px #E6C300",
          bubbleFromUserTextColor: "#0F1923",
          bubbleBorderRadius: 14,
          bubbleFromUserBorderRadius: 14,

          // Font styling
          primaryFont:
            "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontSizeSmall: "10px",

          // Bot avatar – bank99 branding
          botAvatarBackgroundColor: "#0F1923",
          botAvatarInitials: "99",

          // User avatar
          userAvatarBackgroundColor: "#FFD900",
          userAvatarInitials: "KD",

          // Send box styling
          sendBoxBackground: "#FFFFFF",
          sendBoxButtonColor: "#0F1923",
          sendBoxButtonColorOnHover: "#FFD900",
          sendBoxTextColor: "#2B2B2B",
          sendBoxBorderTop: "solid 1px #EBEBEB",
          sendBoxHeight: 52,

          // Suggested actions
          suggestedActionBackgroundColor: "#FFD900",
          suggestedActionBorder: "solid 2px #FFD900",
          suggestedActionBorderRadius: 20,
          suggestedActionTextColor: "#0F1923",

          // Scrollbar
          transcriptOverlayButtonBackground: "#FFD900",
          transcriptOverlayButtonBackgroundOnHover: "#E6C300",

          // Hide upload button
          hideUploadButton: false,
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
  const chatPopup = document.getElementById("chat-popup");
  const popupClose = chatPopup ? chatPopup.querySelector(".chat-popup-close") : null;

  // Check if leadid URL parameter is present
  const urlParams = new URLSearchParams(window.location.search);
  const hasLeadId =
    urlParams.has("leadid") ||
    urlParams.has("leadId") ||
    urlParams.has("LeadId") ||
    urlParams.has("LEADID");

  if (hasLeadId) console.log("Got lead ID. Opening chat");
  let isOpen = hasLeadId; // Auto-open if leadid is present

  // Show proactive popup after 3s if chat hasn't been opened
  let popupTimeout = null;
  if (chatPopup && !hasLeadId) {
    popupTimeout = setTimeout(() => {
      chatPopup.classList.remove("hidden");
    }, 3000);
  }

  // Dismiss popup via close button
  if (popupClose) {
    popupClose.addEventListener("click", () => {
      chatPopup.classList.add("hidden");
    });
  }

  // Set initial state if auto-opening
  if (isOpen) {
    webchat.style.display = "block";
    if (chatPopup) chatPopup.classList.add("hidden");
    if (popupTimeout) clearTimeout(popupTimeout);
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

    // Always hide popup when toggle is clicked
    if (chatPopup) chatPopup.classList.add("hidden");
    if (popupTimeout) clearTimeout(popupTimeout);

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

// Sticky header: toggle .scrolled class based on scroll position
(function setupStickyHeader() {
  const header = document.getElementById('site-header');
  if (!header) return;
  const threshold = 60;
  function onScroll() {
    if (window.scrollY > threshold) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); // run once on load
})();

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
      updateHeroContent("Vielen Dank!", "Wir freuen uns auf das Gespräch mit dir.");
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

  const h1 = heroContent.querySelector('h1');
  const p = heroContent.querySelector('.hero-subtitle');

  if (h1) {
    h1.textContent = heading;
  }

  if (p) {
    p.textContent = paragraph;
  }
}

// Example usage:
// updateHeroContent("Vielen Dank Rafaela", "WIr freuen uns auf den Termin mit ihnen");