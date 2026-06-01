/**
 * Public client settings. NEVER put secrets here.
 * Secrets (Direct Line secret, Speech key) live only in the token broker.
 */

export const brokerEndpoints = {
  directLineToken: "/api/directline/token",
  speechToken: "/api/speech/token",
};

export const defaultLocale = "de-AT";

// Map locale -> preferred Azure Neural TTS voice
export const voiceMap = {
  "de-AT": "Microsoft Server Speech Text to Speech Voice (de-AT, IngridNeural)",
  "de-DE": "Microsoft Server Speech Text to Speech Voice (de-DE, KatjaNeural)",
  "en-US": "Microsoft Server Speech Text to Speech Voice (en-US, AvaMultilingualNeural)",
};
