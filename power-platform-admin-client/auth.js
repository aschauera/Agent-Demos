const AUTH_FLOW_KEY = "pp-admin-auth-flow";

async function requestToken(tokenUrl, body, fetchImpl) {
  const response = await fetchImpl(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await response.json();
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Microsoft Entra returned an invalid token response.");
  }
  if (!response.ok) {
    throw new Error(data.error_description || data.error || `Token request failed (HTTP ${response.status}).`);
  }
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new Error("Microsoft Entra returned no access token.");
  }
  const lifetime = Number(data.expires_in ?? 3600);
  if (!Number.isFinite(lifetime) || lifetime <= 0) {
    throw new Error("Microsoft Entra returned an invalid token lifetime.");
  }
  return { accessToken: data.access_token, expiresAt: Date.now() + lifetime * 1000, refreshToken: data.refresh_token };
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomUrlSafe(cryptoApi, length = 32) {
  const bytes = new Uint8Array(length);
  cryptoApi.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function beginAuthorization({
  tenantId,
  clientId,
  redirectUri,
  scope = "https://api.powerplatform.com/.default",
  resolveOwnerNames = false,
  storage = sessionStorage,
  cryptoApi = crypto,
  location = window.location
}) {
  if (!tenantId || !clientId) {
    throw new Error("Set the tenant ID and public client ID before connecting.");
  }

  const state = randomUrlSafe(cryptoApi);
  const verifier = randomUrlSafe(cryptoApi, 48);
  const digest = await cryptoApi.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  const challenge = base64Url(new Uint8Array(digest));
  const redirect = new URL(redirectUri);
  const requestedScope = resolveOwnerNames ? [...new Set([...scope.split(/\s+/), "offline_access"])].join(" ") : scope;

  storage.setItem(AUTH_FLOW_KEY, JSON.stringify({
    state,
    verifier,
    tenantId,
    clientId,
    redirectUri: redirect.href,
    scope: requestedScope,
    resolveOwnerNames
  }));

  const authorizeUrl = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize`
  );
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirect.href,
    response_mode: "query",
    scope: requestedScope,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  }).toString();
  location.assign(authorizeUrl.href);
}

export async function completeAuthorization({
  search = window.location.search,
  storage = sessionStorage,
  fetchImpl = fetch,
  history = window.history,
  location = window.location
} = {}) {
  const params = new URLSearchParams(search);
  const code = params.get("code");
  const authError = params.get("error");
  if (!code && !authError) {
    return undefined;
  }

  history.replaceState(null, "", `${location.pathname}${location.hash}`);
  const saved = storage.getItem(AUTH_FLOW_KEY);
  storage.removeItem(AUTH_FLOW_KEY);
  if (!saved) {
    throw new Error("The sign-in state expired. Start a new sign-in.");
  }

  let flow;
  try {
    flow = JSON.parse(saved);
  } catch (error) {
    throw new Error("The temporary sign-in state is invalid.", { cause: error });
  }
  if (!flow.state || flow.state !== params.get("state")) {
    throw new Error("Sign-in state validation failed. Start a new sign-in.");
  }
  if (authError) {
    throw new Error(params.get("error_description") || authError);
  }

  const tokenUrl =
    `https://login.microsoftonline.com/${encodeURIComponent(flow.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: flow.clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: flow.redirectUri,
    code_verifier: flow.verifier,
    scope: flow.scope
  });
  const token = await requestToken(tokenUrl, body, fetchImpl);
  const auth = { accessToken: token.accessToken, expiresAt: token.expiresAt };
  if (!flow.resolveOwnerNames) {
    return { ...auth, ownerNameError: "Owner-name resolution is disabled. Reconnect with Resolve owner display names enabled." };
  }
  if (typeof token.refreshToken !== "string" || !token.refreshToken) {
    return { ...auth, ownerNameError: "Microsoft Entra did not issue a refresh token for owner-name resolution. Reconnect to retry." };
  }
  try {
    const ownerToken = await requestToken(tokenUrl, new URLSearchParams({
      client_id: flow.clientId,
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
      scope: "https://graph.microsoft.com/.default"
    }), fetchImpl);
    return { ...auth, ownerAccessToken: ownerToken.accessToken, ownerExpiresAt: ownerToken.expiresAt };
  } catch (error) {
    return { ...auth, ownerNameError: `Owner-name authorization failed: ${error.message}. Grant Microsoft Graph Directory.Read.All delegated permission and admin consent, then reconnect.` };
  }
}

export function clearAuthorizationFlow(storage = sessionStorage) {
  storage.removeItem(AUTH_FLOW_KEY);
}
