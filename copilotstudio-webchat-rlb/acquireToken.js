/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

export async function acquireToken (settings) {
  const msalInstance = new window.msal.PublicClientApplication({
    auth: {
      clientId: settings.appClientId,
      authority: `https://login.microsoftonline.com/${settings.tenantId}`,
      redirectUri: settings.redirectUri || 'http://localhost:5500',
    },
  })

  await msalInstance.initialize()
  
  // Handle redirect response if present
  const redirectResponse = await msalInstance.handleRedirectPromise()
  if (redirectResponse) {
    console.log('Redirect response received:', redirectResponse)
    return redirectResponse.accessToken
  }
  
  const loginRequest = {
    scopes: ['00000007-0000-0000-c000-000000000000/.default'],
  }

  // Try silent token acquisition first
  try {
    const accounts = msalInstance.getAllAccounts()
    if (accounts.length > 0) {
      const response = await msalInstance.acquireTokenSilent({
        ...loginRequest,
        account: accounts[0],
      })
      return response.accessToken
    }
  } catch (e) {
    if (!(e instanceof window.msal.InteractionRequiredAuthError)) {
      throw e
    }
  }

  // If no accounts or silent acquisition failed, use redirect flow
  console.log('No cached token found, redirecting to login...')
  await msalInstance.loginRedirect(loginRequest)
  // This line won't be reached as the page will redirect
  return null
}
