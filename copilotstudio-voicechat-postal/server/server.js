/**
 * Token broker for the Copilot Studio voice webchat.
 *
 * Endpoints:
 *   GET /api/directline/token  -> { token, conversationId?, expires_in }
 *   GET /api/speech/token      -> { token, region }
 *   GET /healthz               -> 200 ok
 *
 * Secrets (env):
 *   DIRECTLINE_SECRET   - Copilot Studio Direct Line secret
 *   SPEECH_KEY          - Azure AI Speech key
 *   SPEECH_REGION       - Azure region (e.g. westeurope)
 *
 * Optional:
 *   PORT                - default 3000
 *   ALLOWED_ORIGINS     - comma separated list (defaults to '*')
 *   DIRECTLINE_REGION   - 'global' (default) or 'europe'
 *   TRUSTED_ORIGINS     - comma separated list embedded in DL token (recommended)
 */

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const DIRECTLINE_SECRET = process.env.DIRECTLINE_SECRET;
const SPEECH_KEY = process.env.SPEECH_KEY;
const SPEECH_REGION = process.env.SPEECH_REGION;
const DIRECTLINE_REGION = (process.env.DIRECTLINE_REGION || "global").toLowerCase();
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim());
const TRUSTED_ORIGINS = (process.env.TRUSTED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);

const DIRECTLINE_BASE = DIRECTLINE_REGION === "europe"
  ? "https://europe.directline.botframework.com"
  : "https://directline.botframework.com";

const app = express();
app.disable("x-powered-by");
app.use(express.json());
app.use(cors({
  origin: ALLOWED_ORIGINS.includes("*") ? true : ALLOWED_ORIGINS,
  methods: ["GET", "OPTIONS"],
}));

app.get("/healthz", (_req, res) => res.status(200).json({ status: "ok" }));

app.get("/api/directline/token", async (_req, res) => {
  if (!DIRECTLINE_SECRET) {
    return res.status(500).json({ error: "DIRECTLINE_SECRET not configured" });
  }
  try {
    const userId = "dl_" + crypto.randomBytes(8).toString("hex");
    const body = { user: { id: userId, name: "Web user" } };
    if (TRUSTED_ORIGINS.length) body.trustedOrigins = TRUSTED_ORIGINS;

    const r = await fetch(`${DIRECTLINE_BASE}/v3/directline/tokens/generate`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${DIRECTLINE_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const text = await r.text();
      console.error("DL token error", r.status, text);
      return res.status(502).json({ error: "Direct Line token exchange failed", status: r.status });
    }
    const data = await r.json();
    res.set("Cache-Control", "no-store");
    return res.json(data);
  } catch (err) {
    console.error("DL token exception", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

app.get("/api/speech/token", async (_req, res) => {
  if (!SPEECH_KEY || !SPEECH_REGION) {
    return res.status(500).json({ error: "SPEECH_KEY/SPEECH_REGION not configured" });
  }
  try {
    const r = await fetch(
      `https://${SPEECH_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": SPEECH_KEY,
          "Content-Length": "0",
        },
      }
    );
    if (!r.ok) {
      const text = await r.text();
      console.error("Speech token error", r.status, text);
      return res.status(502).json({ error: "Speech token issue failed", status: r.status });
    }
    const token = await r.text();
    res.set("Cache-Control", "no-store");
    return res.json({ token, region: SPEECH_REGION });
  } catch (err) {
    console.error("Speech token exception", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

app.listen(PORT, () => {
  console.log(`Token broker listening on :${PORT}`);
  console.log(`DirectLine: ${DIRECTLINE_BASE}  (region=${DIRECTLINE_REGION})`);
  console.log(`Speech region: ${SPEECH_REGION || "(unset)"}`);
  if (ALLOWED_ORIGINS.includes("*")) console.warn("CORS: allowing all origins (set ALLOWED_ORIGINS for production)");
});
