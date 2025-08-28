// Creata a function to fetch the Direct Line secret from the secrets.json file
(async function () {
  const response = await fetch("secrets.json");
  const data = await response.json();
  let secret = data.directLineSecret;
  let speechRegion = data.speechRegion;
  let speechKey = data.speechKey;

  // Get token using a POST with a secret request to the Copilot Studio Token endpoint (secure, recommended)
  const res = await fetch(
    "https://europe.directline.botframework.com/v3/directline/tokens/generate",
    {
      headers: {
        Authorization: "Bearer " + secret,
      },
      method: "POST",
    }
  );

  //Get token from response
  const { token } = await res.json();
  // console.log("token ", token);
  console.log("Received token. Acquiring speech resource...");
  // Create the ponyfill factory function, which can be called to create a concrete implementation of the ponyfill.
  const webSpeechPonyfillFactory =
    await window.WebChat.createCognitiveServicesSpeechServicesPonyfillFactory({
      // We are passing the Promise function to the "credentials" field.
      // This function will be called every time the token is being used.
      credentials: {
        region: speechRegion,
        subscriptionKey: speechKey,
      },
    });
  // Create a store to listen for the direct line connection to be fulfilled, then triggers conversation start topic
  const store = window.WebChat.createStore(
    {},
    ({ dispatch }) =>
      (next) =>
      (action) => {
        console.log("Action received:", action);
        // HANDLE CONVERSATION START
        // Listen for the direct line connection to be fulfilled, then triggers conversation start topic
        if (action.type === "DIRECT_LINE/CONNECT_FULFILLED") {
          console.log("Direct line connected successfully");
          dispatch({
            type: "DIRECT_LINE/POST_ACTIVITY",
            meta: { method: "microphone" },
            payload: {
              activity: {
                type: "event",
                name: "startConversation",
                from: { id: "user1" },
              },
            },
          });
        }
        // Listen for incoming activities that the webchat client needs to handle
        if (action.type === "DIRECT_LINE/INCOMING_ACTIVITY") {
          const { activity } = action.payload;
          // Handle only incoming activities that are of type event and have a name of "showCardSelection"
          if (activity.name === "showCardSelection") {
            console.log("Card selection event received : ", activity.value);

            // Dispatch a new activity to the bot with the selected card value
            const event = new Event("webchatincomingactivity");
            event.data = activity;
            window.dispatchEvent(event);
          }
        }

        return next(action);
      }
  );

  // Set style options.
  const styleOptions = {
    accent: "#0078D4",
    autoScrollSnapOnPage: true,
    autoScrollSnapOnPageOffset: 0,
    avatarBorderRadius: "48%",
    avatarSize: 31,
    backgroundColor: "#ffffff",
    botAvatarBackgroundColor: "#00274b",
    botAvatarImage:
      "https://customcopilotsopenaiblob.blob.core.windows.net/img/OesiAvata.png?sp=r&st=2025-05-16T06:15:59Z&se=2025-10-11T14:15:59Z&spr=https&sv=2024-11-04&sr=b&sig=qPwmzzu9NoZpqdt2qDADKzl89rW58phcjX%2BH88p%2BrhQ%3D",
    botAvatarInitials: "B",
    bubbleAttachmentMaxWidth: 480,
    bubbleAttachmentMinWidth: 250,
    bubbleBackground: "#ffffff",
    bubbleBorderColor: "#00274b",
    bubbleBorderRadius: 16,
    bubbleBorderStyle: "solid",
    bubbleBorderWidth: 1,
    bubbleFromUserBackground: "#ebefff",
    bubbleFromUserBorderColor: "#f5f5f5",
    bubbleFromUserBorderRadius: 16,
    bubbleFromUserBorderStyle: "solid",
    bubbleFromUserBorderWidth: 1,
    bubbleFromUserNubOffset: 0,
    bubbleFromUserNubSize: 0,
    bubbleFromUserTextColor: "#242424",
    bubbleImageHeight: 10,
    bubbleImageMaxHeight: 240,
    bubbleImageMinHeight: 240,
    bubbleMessageMaxWidth: 480,
    bubbleMessageMinWidth: 120,
    bubbleMinHeight: 50,
    bubbleNubOffset: 0,
    bubbleTextColor: "#242424",
    emojiSet: true,
    fontSizeSmall: "70%",
    hideUploadButton: false,
    messageActivityWordBreak: "break-word",
    monospaceFont: "Consolas",
    paddingRegular: 10,
    paddingWide: 10,
    primaryFont: null,
    sendBoxBackground: "#e8e9eb",
    sendBoxBorderTop: "solid 1px #808080",
    sendBoxButtonColor: "#0078d4",
    sendBoxButtonColorOnHover: "#006cbe",
    sendBoxButtonShadeBorderRadius: 40,
    sendBoxButtonShadeColorOnHover: "",
    sendBoxHeight: 60,
    sendBoxPlaceholderColor: "#171616",
    sendBoxTextColor: "#2e2d2d",
    showAvatarInGroup: "status",
    spinnerAnimationHeight: 16,
    spinnerAnimationPadding: 12,
    spinnerAnimationWidth: 16,
    subtleColor: "#000000FF",
    suggestedActionBackgroundColor: "#006FC4FF",
    suggestedActionBackgroundColorOnHover: "#0078D4",
    suggestedActionBorderColor: "",
    suggestedActionBorderRadius: 10,
    suggestedActionBorderWidth: 1,
    suggestedActionLayout: "flow",
    suggestedActionTextColor: "#FFFFFFFF",
    typingAnimationBackgroundImage:
      "url('https://wpamelia.com/wp-content/uploads/2018/11/ezgif-2-6d0b072c3d3f.gif')",
    typingAnimationDuration: 5000,
    typingAnimationHeight: 20,
    typingAnimationWidth: 64,
    userAvatarBackgroundColor: "#222222",
    userAvatarImage:
      "https://avatars.githubusercontent.com/u/8174072?v=4&size=64",
    userAvatarInitials: "U",
  };

  console.log("Speech resource successfully created. Creating webchat...");
  //Create the Web Chat object with the speech capabilities.
  var dl = window.WebChat.createDirectLine({
    domain: "https://europe.directline.botframework.com/v3/directline",
    token,
  });
  const webChatOptions = {
    directLine: dl,
    store,
    //Set language
    language: document.getElementById("locale").value,
    //Set locale,
    locale: document.getElementById("locale").value,
    //Select voice
    selectVoice: (voices, activity) => {
      activity.locale = document.getElementById("locale").value;
      console.log("Activity Locale: ", activity.locale);
      var selectedVoice =
        voices.find((voice) =>
          activity.locale == "de-DE"
            ? voice.name ===
              "Microsoft Server Speech Text to Speech Voice (en-US, AvaMultilingualNeural)"
            : voice.name ===
              "Microsoft Server Speech Text to Speech Voice (en-US, AvaMultilingualNeural)"
        ) || voices[0];
      // console.log(
      //   "Available voices: ",
      //   voices.map((voice) => voice.name).join(",\n ")
      // );
      console.log("Selected Voice: ", selectedVoice.name);
      console.log("Chat locale: ", document.getElementById("locale").value);
      return selectedVoice;
    },
    from: { id: "user1" },
    styleOptions,
    webSpeechPonyfillFactory,
    openOnLoad: false
  };

  // Pass a Web Speech ponyfill factory to renderWebChat.
  window.WebChat.renderWebChat(
    webChatOptions,
    document.getElementById("webchat")
  );
  //Post a locale event to the bot when the local selection changes
  document.getElementById("locale").addEventListener("change", function () {
    console.log("Locale changed to: ", document.getElementById("locale").value);
    store.dispatch({
      type: "DIRECT_LINE/POST_ACTIVITY",
      meta: { method: "button" },
      payload: {
        activity: {
          type: "event",
          name: "localeSelection",
          from: { id: "user1" },
          value: document.getElementById("locale").value,
        },
      },
    });
  });
  //Register an event listener to handle incoming activities in the DOM
  window.addEventListener("webchatincomingactivity", ({ data }) => {
    // Show the card selection buttons
    document.getElementById("cardSelection").style.visibility = "visible";
    console.log(`Received an activity of type "${data.type}":`);
    console.log(data);
  });

  document.querySelector("#webchat > *").focus();
})().catch((err) => console.error(err));
