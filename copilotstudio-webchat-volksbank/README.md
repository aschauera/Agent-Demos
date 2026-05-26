# s Wohnfinanz – Copilot Studio WebChat Client

A static web application that embeds a Microsoft Copilot Studio agent via the **Direct Line channel** into a custom-branded website modelled after [s Wohnfinanz](https://www.swohnfinanz.at). The chat widget appears as a floating button in the lower-right corner and connects directly to a Copilot Studio bot using a **Direct Line token endpoint** — no server-side code required.

> **Connection approach:** This sample calls the Direct Line token endpoint **directly** from the browser — it does **not** use the `@microsoft/agents-copilotstudio-client` SDK. If you are looking for a sample that uses the SDK instead, see the [`copilotstudio-a365sdk-js`](../copilotstudio-a365sdk-js) folder.

---

## Frameworks & Libraries

| Library | Version | Purpose |
|---|---|---|
| [`botframework-webchat`](https://github.com/microsoft/BotFramework-WebChat) | `4.18.0` | Renders the chat UI and manages the Direct Line connection |
| [`@azure/msal-browser`](https://github.com/AzureAD/microsoft-authentication-library-for-js) | `4.13.1` | MSAL redirect-flow token acquisition (included for reference; not active in this sample) |
| **nginx** (Docker only) | `alpine` | Serves the static files in containerised deployments |

> **Not used here:** [`@microsoft/agents-copilotstudio-client`](https://www.npmjs.com/package/@microsoft/agents-copilotstudio-client) — this sample bypasses the SDK and calls the Direct Line token endpoint directly. See [`copilotstudio-a365sdk-js`](../copilotstudio-a365sdk-js) for a sample built on that library.

All libraries are loaded from a CDN (`unpkg.com`) — no build step or `npm install` is needed for local development.

---

## Prerequisites

1. **Microsoft Copilot Studio agent** – a published agent with the Direct Line channel enabled.  
   Grab the **Direct Line token endpoint** from _Copilot Studio → Settings → Channels → Custom website_.

2. **Local web server** for development — the VS Code extension [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) works out of the box on port `5500`.

3. **Docker** (optional) – required only for the containerised deployment path.

4. **Azure CLI** with the `containerapp` extension (optional) – required only for the Azure Container Apps deployment path.

---

## Configuration

Open `settings.js` and fill in the values for your environment:

```js
// Direct Line token endpoint (from Copilot Studio > Settings > Channels > Custom website)
export const directLineTokenEndpoint = '<token-endpoint-url>'

// Direct Line secret – leave empty; token endpoint is preferred
export const directLineSecret = ''
```

> **Where to find the value**  
> _Copilot Studio → Settings → Channels → Custom website_: token endpoint URL

### Optional: URL parameter – Lead ID

The client reads an optional `leadid` query parameter from the URL and automatically sends it to the bot as context on connect:

```
http://localhost:5500?leadid=ABC123
```

---

## Local Development

1. Clone the repository.
2. Edit `settings.js` with your Copilot Studio connection details (see above).
3. Open the folder in VS Code and start **Live Server** (`Right-click index.html → Open with Live Server`).
4. Navigate to `http://localhost:5500` in your browser.
5. Click the chat button in the lower-right corner to start a conversation.

---

## Deployment

### Option 1 – Azure Static Web Apps

Uses the [SWA CLI](https://azure.github.io/static-web-apps-cli/) and the configuration in `swa-cli.config.json`.

```bash
# Install the SWA CLI globally (once)
npm install -g @azure/static-web-apps-cli

# Deploy
swa deploy --env production
```

The `staticwebapp.config.json` file configures:
- SPA fallback routing (all routes rewrite to `index.html`)
- Correct MIME types for `.js` / `.mjs` ES modules
- Public anonymous access

### Option 2 – Docker / Azure Container Apps

The `Dockerfile` builds an **nginx:alpine** image that serves the static files.

```bash
# Build the image
docker build -t swohnfinanz-webclient .

# Run locally
docker run -p 8080:80 swohnfinanz-webclient
# → open http://localhost:8080
```

**Deploy to Azure Container Apps** using the included PowerShell script:

```powershell
# Interactive – prompts for resource group and container registry
.\deploy-containerapp.ps1

# Or supply parameters directly
.\deploy-containerapp.ps1 `
  -ResourceGroupName "rg-swohnfinanz" `
  -ContainerRegistryName "myacr" `
  -ContainerAppName "swohnfinanz-webclient" `
  -Location "westeurope"
```

The script will:
1. Build and push the Docker image to the specified Azure Container Registry.
2. Create (or update) an Azure Container Apps environment and container app.
3. Output the public HTTPS URL of the deployed application.

> **Note:** Make sure the deployed URL is reachable publicly; no additional Azure AD configuration is required when using the Direct Line token endpoint.

---

## Project Structure

```
copilotstudio-webchat-skasse/
├── index.html              # Main page (s Wohnfinanz branded layout)
├── index.css               # All styles (s Wohnfinanz design system)
├── index.js                # Chat widget logic – Direct Line connection & WebChat render
├── settings.js             # Connection settings (Copilot Studio endpoint, MSAL config)
├── acquireToken.js         # MSAL redirect-flow token acquisition helper
├── Dockerfile              # nginx:alpine container image
├── nginx.conf              # nginx config with gzip, security headers, health endpoint
├── deploy-containerapp.ps1 # PowerShell script for Azure Container Apps deployment
├── staticwebapp.config.json# Azure Static Web Apps routing & MIME config
├── swa-cli.config.json     # SWA CLI project configuration
└── img/                    # Static assets (bot avatar, background images)
```

---

## Authentication Flow

This application uses the **Direct Line token endpoint** provided by Copilot Studio. On page load, `index.js` calls the token endpoint URL configured in `settings.js`, receives a short-lived Direct Line token, and uses it to open a WebChat connection — no user login or App Registration required.

The `acquireToken.js` file (MSAL redirect flow) is included in the repository for reference if you ever need to switch to an authenticated bot configuration, but it is not invoked in the current setup.