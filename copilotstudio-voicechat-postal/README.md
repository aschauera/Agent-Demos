# Copilot Studio Voice Webchat — Austrian Post

Minimal web client for a Copilot Studio agent with **two-way voice** (Web Chat + Azure Speech ponyfill) and a tiny **Node token broker** that keeps the Direct Line secret and Speech key server-side.

Single nginx container serves the static UI and proxies `/api/*` to the broker. Deployed to Azure Container Apps.

```
Browser ──► nginx (static UI)
            └─► /api/* ─► Node broker ─► Direct Line + Azure Speech (STS token)
```

## Prerequisites

- Node 18+ (local dev only)
- Docker (local container test, optional)
- Azure CLI logged in (`az login`)
- A Copilot Studio agent published to the **Direct Line** channel → copy the secret
- Permission to create resources in an Azure subscription

## What you need to configure

Three secrets:

| Value | Where to get it |
|---|---|
| `DIRECTLINE_SECRET` | Copilot Studio → Settings → Channels → Direct Line/Custom website |
| `SPEECH_KEY` | Azure AI Speech resource → Keys and Endpoint |
| `SPEECH_REGION` | Same blade (e.g. `westeurope`) |

For local dev, put them in `server/.env`. For Azure, the deploy script prompts and wires them in as Container App secrets.

## Local dev

```powershell
cd server
Copy-Item .env.example .env       # then edit .env with your secrets
npm install
npm start                          # broker on http://localhost:3000
```

In a second terminal, serve the static UI on a different port:

```powershell
cd public
npx http-server -p 8080 -c-1
```

For local dev, set `ALLOWED_ORIGINS=http://localhost:8080` in `.env` and point `public/settings.js` `brokerEndpoints.*` at `http://localhost:3000/api/...`.

Open http://localhost:8080 and click the mic icon.

## Deploy to Azure

Both scripts are fully interactive — for every Azure resource (Subscription, Location, RG, ACR, ACA Env, Container App, Speech) you can pick from a list or choose **[NEW]**.

```powershell
# 1. Provision shared infra (RG, ACR, ACA Env, Speech)
.\provision-azure.ps1

# 2. Build image + deploy Container App (prompts for Direct Line secret)
.\deploy-containerapp.ps1
```

The deploy script prints the public URL when done.

## Update flow

Re-run `.\deploy-containerapp.ps1` and pick the existing Container App. It builds a fresh image tag and rolls a new revision.

## Project layout

```
public/                 Static UI (HTML/CSS/JS, no build)
  index.html
  index.css
  index.js              Web Chat init + Speech ponyfill wiring
  settings.js           Broker endpoints + per-locale voices
  img/post-logo.svg
server/                 Node token broker (Express)
  server.js             /api/directline/token, /api/speech/token, /healthz
  package.json
  .env.example
nginx.conf              Serves /public, proxies /api/* → 127.0.0.1:3000
Dockerfile              nginx + node in one image
entrypoint.sh           Starts node in background, nginx in foreground
provision-azure.ps1     RG / ACR / ACA Env / Speech (list+select+[NEW])
deploy-containerapp.ps1 Build + deploy Container App (list+select+[NEW])
```

## Security

- Direct Line secret and Speech key never reach the browser.
- Browser receives short-lived (~10 min) tokens; the ponyfill refreshes automatically.
- Restrict `ALLOWED_ORIGINS` (broker CORS) and `TRUSTED_ORIGINS` (Direct Line token) to your site origin in production.

## Troubleshooting

| Symptom | Check |
|---|---|
| Chat loads but mic does nothing | Browser must be on HTTPS (or localhost). Allow mic permission. |
| 401 from `/api/directline/token` | `DIRECTLINE_SECRET` correct? Channel enabled in Copilot Studio? |
| 401 from `/api/speech/token` | `SPEECH_KEY` / `SPEECH_REGION` match the Azure Speech resource. |
| No voice / wrong voice | Update `voiceMap` in `public/settings.js`. |
| Container logs | `az containerapp logs show -n <app> -g <rg> --follow` |
