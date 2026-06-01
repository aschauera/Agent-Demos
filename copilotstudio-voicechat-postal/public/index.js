/**
 * Copilot Studio voice webchat — Austrian Post sample.
 * - Direct Line token fetched from /api/directline/token (broker)
 * - Speech token fetched from /api/speech/token (broker) and refreshed via fetchCallback
 */

import { brokerEndpoints, defaultLocale, voiceMap } from "./settings.js";

let currentLocale = defaultLocale;

async function fetchSpeechCredentials() {
  const res = await fetch(brokerEndpoints.speechToken);
  if (!res.ok) throw new Error(`Speech token fetch failed: ${res.status}`);
  return res.json(); // { token, region }
}

async function fetchDirectLineToken() {
  const res = await fetch(brokerEndpoints.directLineToken);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Direct Line token fetch failed: ${res.status} ${body}`);
  }
  return res.json(); // { token, conversationId?, expires_in }
}

async function initializeChat() {
  try {
    const [dlTokenResp, speechCreds] = await Promise.all([
      fetchDirectLineToken(),
      fetchSpeechCredentials(),
    ]);

    // Speech ponyfill — credentials.authorizationToken can be a Promise factory
    // so the SDK can re-fetch a fresh token (~10 min lifetime) on expiry.
    const webSpeechPonyfillFactory =
      await window.WebChat.createCognitiveServicesSpeechServicesPonyfillFactory({
        credentials: {
          region: speechCreds.region,
          authorizationToken: async () => {
            const fresh = await fetchSpeechCredentials();
            return fresh.token;
          },
        },
      });

    const store = window.WebChat.createStore(
      {},
      ({ dispatch }) => (next) => (action) => {
        if (action.type === "DIRECT_LINE/CONNECT_FULFILLED") {
          console.log("Direct Line connected");
          dispatch({
            type: "DIRECT_LINE/POST_ACTIVITY",
            meta: { method: "keyboard" },
            payload: {
              activity: {
                type: "event",
                name: "startConversation",
                from: { id: "user1" },
                locale: currentLocale,
              },
            },
          });
        }
        if (action.type === "DIRECT_LINE/INCOMING_ACTIVITY") {
          const a = action.payload.activity;
          if (a.type === "trace") return; // suppress trace
        }
        return next(action);
      }
    );

    const directLine = window.WebChat.createDirectLine({ token: dlTokenResp.token });

    const styleOptions = {
      accent: "#FFCC00",
      subtle: "#FFF7CC",
      bubbleBackground: "#FFFFFF",
      bubbleBorder: "solid 1px #E8E8E8",
      bubbleBorderRadius: 12,
      bubbleFromUserBackground: "#FFCC00",
      bubbleFromUserBorder: "solid 1px #E6B800",
      bubbleFromUserTextColor: "#1A1A1A",
      bubbleFromUserBorderRadius: 12,
      primaryFont: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      botAvatarBackgroundColor: "#1A1A1A",
      botAvatarInitials: "P",
      userAvatarBackgroundColor: "#FFCC00",
      userAvatarInitials: "Du",
      sendBoxButtonColor: "#1A1A1A",
      sendBoxButtonColorOnHover: "#FFCC00",
      suggestedActionBackgroundColor: "#FFCC00",
      suggestedActionTextColor: "#1A1A1A",
      suggestedActionBorder: "solid 2px #FFCC00",
      suggestedActionBorderRadius: 18,
      hideUploadButton: true,
    };

    window.WebChat.renderWebChat(
      {
        directLine,
        store,
        locale: currentLocale,
        webSpeechPonyfillFactory,
        selectVoice: (voices) => {
          const targetName = voiceMap[currentLocale];
          return (
            voices.find((v) => v.name === targetName) ||
            voices.find((v) => v.lang === currentLocale) ||
            voices[0]
          );
        },
        styleOptions,
      },
      document.getElementById("webchat")
    );
  } catch (err) {
    console.error("Failed to initialize chat:", err);
    const el = document.getElementById("webchat");
    if (el) {
      el.innerHTML = `
        <div style="padding:20px;color:#a01313;background:#fde7e7;border-radius:8px;margin:12px;font-size:14px;">
          <strong>Chat konnte nicht gestartet werden.</strong><br/>
          ${err.message}<br/>
          <small>Bitte überprüfe die Konfiguration des Token-Brokers (Direct Line Secret &amp; Speech Key).</small>
        </div>`;
    }
  }
}

function setupChatToggle() {
  const toggle = document.getElementById("chat-toggle");
  const panel = document.getElementById("webchat-panel");
  const popup = document.getElementById("chat-popup");
  const popupClose = popup?.querySelector(".chat-popup-close");

  let initialized = false;
  let isOpen = false;

  const popupTimeout = setTimeout(() => {
    if (!isOpen && popup) popup.classList.remove("hidden");
  }, 3000);

  popupClose?.addEventListener("click", () => popup.classList.add("hidden"));

  toggle.addEventListener("click", () => {
    isOpen = !isOpen;
    panel.style.display = isOpen ? "flex" : "none";
    popup?.classList.add("hidden");
    clearTimeout(popupTimeout);
    if (isOpen && !initialized) {
      initialized = true;
      initializeChat();
    }
  });
}

function setupLocaleHandler() {
  const sel = document.getElementById("locale");
  if (!sel) return;
  sel.value = currentLocale;
  sel.addEventListener("change", () => {
    currentLocale = sel.value;
    console.log("Locale changed:", currentLocale);
    // Page reload is the simplest way to re-render webchat with new locale/voice.
    // For a richer UX a full re-render of WebChat would be needed.
    const panel = document.getElementById("webchat-panel");
    if (panel && panel.style.display === "flex") {
      document.getElementById("webchat").innerHTML = "";
      initializeChat();
    }
  });
}

setupChatToggle();
setupLocaleHandler();
