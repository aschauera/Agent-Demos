import { API_ROOT, getNamespacePath } from "./api-catalog.js";

export class HttpApiError extends Error {
  constructor({ status, code, message, retryAfter, details }) {
    super(message || `Power Platform API returned HTTP ${status}.`);
    this.name = "HttpApiError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.details = details;
  }
}

function containsUnsafePath(pathname) {
  try {
    return pathname.split("/").some((segment) => {
      const decoded = decodeURIComponent(segment);
      return decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\");
    });
  } catch {
    return true;
  }
}

export function buildApiUrl(section, path, apiVersion) {
  if (!section?.namespace) {
    throw new TypeError("Select a documented API section.");
  }
  if (!apiVersion?.trim()) {
    throw new TypeError("Enter the API version shown in the operation reference.");
  }

  const rawPath = path.trim().replace(/^\/+/, "");
  if (
    !rawPath ||
    rawPath.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(rawPath) ||
    rawPath.includes("://") ||
    rawPath.includes("\\") ||
    rawPath.includes("#") ||
    /\{[^}]+\}/.test(rawPath) ||
    /%(?:2f|5c)/i.test(rawPath)
  ) {
    throw new TypeError("Enter a relative resource path from the selected API namespace and replace any {parameter} placeholders.");
  }

  const namespacePath = getNamespacePath(section);
  const url = new URL(`${namespacePath}/${rawPath}`, `${API_ROOT}/`);
  const basePath = `/${namespacePath}`;
  if (
    url.origin !== API_ROOT ||
    (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) ||
    containsUnsafePath(url.pathname)
  ) {
    throw new TypeError("The resource path must stay inside the selected API namespace.");
  }

  const existingVersion = url.searchParams.get("api-version");
  if (existingVersion && existingVersion !== apiVersion.trim()) {
    throw new TypeError("The route API version conflicts with the API version field.");
  }
  url.searchParams.set("api-version", apiVersion.trim());
  return url;
}

export function validateNextLink(section, nextLink) {
  const url = new URL(nextLink);
  const namespacePath = `/${getNamespacePath(section)}`;
  if (
    url.origin !== API_ROOT ||
    (url.pathname !== namespacePath && !url.pathname.startsWith(`${namespacePath}/`)) ||
    containsUnsafePath(url.pathname)
  ) {
    throw new TypeError("The API returned a next link outside the selected namespace.");
  }
  return url;
}

function parseErrorBody(data, status, retryAfter) {
  const error = data && typeof data === "object" ? data.error ?? data : {};
  const nested = error.details ?? error.innererror ?? error.innerError;
  return new HttpApiError({
    status,
    code: typeof error.code === "string" ? error.code : undefined,
    message: typeof error.message === "string"
      ? error.message
      : typeof data === "string" && data
        ? data
        : undefined,
    retryAfter,
    details: nested ?? data
  });
}

async function readResponse(response, responseType) {
  if (response.status === 204) {
    return undefined;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (response.ok && response.status !== 202 && responseType === "blob") return response.blob();
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  if (contentType.includes("json")) {
    try {
      return JSON.parse(text);
    } catch (error) {
      if (!response.ok) {
        return { error: { message: text, code: `HTTP_${response.status}` } };
      }
      throw new Error("The API returned malformed JSON.", { cause: error });
    }
  }
  return text;
}

async function sendRequest({ url, method, body, accessToken, fetchImpl, signal, responseType }) {
  if (!accessToken) {
    throw new Error("Connect with a delegated Power Platform API token first.");
  }

  const headers = new Headers({
    Accept: responseType === "blob" ? "application/zip, application/octet-stream, application/json" : "application/json",
    Authorization: `Bearer ${accessToken}`
  });
  const init = { method, headers, signal };
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }
    throw new Error(
      "The request could not reach the Power Platform API. Check connectivity and browser CORS policy.",
      { cause: error }
    );
  }

  const data = await readResponse(response, responseType);
  if (!response.ok) {
    throw parseErrorBody(data, response.status, response.headers.get("retry-after"));
  }

  return {
    status: response.status,
    data,
    headers: response.headers,
    url: response.url || url.href
  };
}

export function requestPowerPlatformApi({
  section,
  path,
  apiVersion,
  method = "GET",
  body,
  accessToken,
  fetchImpl = fetch,
  signal,
  responseType
}) {
  const normalizedMethod = method.toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(normalizedMethod)) {
    throw new TypeError("Use a supported Power Platform API method.");
  }
  if (["GET", "DELETE"].includes(normalizedMethod) && body !== undefined) {
    throw new TypeError(`${normalizedMethod} requests must not include a JSON body.`);
  }
  const url = buildApiUrl(section, path, apiVersion);
  return sendRequest({
    url,
    method: normalizedMethod,
    body,
    accessToken,
    fetchImpl,
    signal,
    responseType
  });
}

export function requestNextPage({ section, nextLink, accessToken, fetchImpl = fetch, signal }) {
  const url = validateNextLink(section, nextLink);
  return sendRequest({
    url,
    method: "GET",
    accessToken,
    fetchImpl,
    signal
  });
}

function retryDelay(response) {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) {
    throw new Error("The asynchronous response omitted Retry-After; polling was stopped.");
  }
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(retryAfter);
  if (Number.isNaN(date)) {
    throw new Error("The asynchronous response returned an invalid Retry-After value.");
  }
  return Math.max(0, date - Date.now());
}

function waitForRetry(delay, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The request was cancelled.", "AbortError"));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("The request was cancelled.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function pollAcceptedOperation({
  section,
  response,
  accessToken,
  fetchImpl = fetch,
  signal,
  onWait = () => {},
  maxPolls = 120
}) {
  if (response.status !== 202) {
    return response;
  }
  const operationLocation = response.headers.get("location");
  if (!operationLocation) {
    throw new Error("The API accepted the request but omitted its operation Location.");
  }
  const operationUrl = validateNextLink(section, new URL(operationLocation, response.url || API_ROOT).href);
  let latestResponse = response;

  for (let poll = 0; poll < maxPolls; poll += 1) {
    const delay = retryDelay(latestResponse);
    onWait({ poll: poll + 1, delay });
    await waitForRetry(delay, signal);
    latestResponse = await sendRequest({
      url: operationUrl,
      method: "GET",
      accessToken,
      fetchImpl,
      signal
    });

    const status = latestResponse.data?.status;
    if (typeof status !== "string") {
      return latestResponse;
    }
    if (["succeeded", "success", "completed"].includes(status.toLowerCase())) {
      return latestResponse;
    }
    if (["failed", "error", "cancelled", "canceled"].includes(status.toLowerCase())) {
      throw new HttpApiError({
        status: latestResponse.status,
        code: latestResponse.data?.error?.code,
        message:
          latestResponse.data?.error?.message ??
          latestResponse.data?.message ??
          `The asynchronous operation ended with status ${status}.`,
        details: latestResponse.data
      });
    }
    if (!["running", "notstarted", "inprogress", "pending", "accepted"].includes(status.toLowerCase())) {
      return latestResponse;
    }
  }

  throw new Error(`The asynchronous operation exceeded the ${maxPolls}-poll client limit.`);
}

export function extractRows(data) {
  if (Array.isArray(data)) {
    return data;
  }
  if (!data || typeof data !== "object") {
    return [];
  }
  if (Array.isArray(data.value)) {
    return data.value;
  }
  return [];
}

export function extractNextLink(data) {
  if (!data || typeof data !== "object") return undefined;
  const nextLink = data["@odata.nextLink"] ?? data["@odata.nextlink"] ?? data.nextLink;
  return typeof nextLink === "string" ? nextLink : undefined;
}

export function getApiErrorDescription(error) {
  const parts = [];
  if (error instanceof HttpApiError) {
    parts.push(`HTTP ${error.status}`);
    if (error.code) {
      parts.push(error.code);
    }
    if (error.message) {
      parts.push(error.message);
    }
    if (error.retryAfter) {
      parts.push(`Retry-After: ${error.retryAfter}`);
    }
  } else {
    parts.push(error?.message ?? "Unexpected API client error.");
  }
  return parts.join(" — ");
}
