const API_VERSION = "2016-11-01";
const REPORT_NAME = "BillingDetailsPerEnvironment";
const API_ROOT = "https://preview.api.flow.microsoft.com/copilotstudio/tenants";
const TRUSTED_API_ORIGIN = new URL(API_ROOT).origin;
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class ReportingApiError extends Error {
  constructor(message, { status, code, cause } = {}) {
    super(message, { cause });
    this.name = "ReportingApiError";
    this.status = status;
    this.code = code;
  }
}

export function validateRequest({ tenantId, token, startDate, endDate, granularity }) {
  if (!GUID_PATTERN.test(tenantId)) {
    throw new ReportingApiError("Tenant ID must be a valid GUID.");
  }
  if (!token?.trim()) {
    throw new ReportingApiError("A delegated Power Automate access token is required.");
  }
  if (!isValidDate(startDate) || !isValidDate(endDate)) {
    throw new ReportingApiError("Start and end dates must use yyyy-MM-dd.");
  }
  if (endDate < startDate) {
    throw new ReportingApiError("End date must be on or after start date.");
  }
  if (!["Daily", "Summary"].includes(granularity)) {
    throw new ReportingApiError("Granularity must be Daily or Summary.");
  }
}

export function withApiVersion(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new ReportingApiError("The API returned an invalid request URL.", { cause: error });
  }

  if (url.origin !== TRUSTED_API_ORIGIN) {
    throw new ReportingApiError(
      `Refusing to send credentials to an untrusted API origin: ${url.origin}.`
    );
  }

  url.searchParams.set("api-version", API_VERSION);
  return url.toString();
}

export function parseRetryAfter(value) {
  if (value === null || !/^\d+$/.test(value.trim())) {
    throw new ReportingApiError("The API returned a missing or invalid Retry-After header.");
  }
  return Number.parseInt(value, 10);
}

export function delay(seconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("The request was cancelled.", "AbortError"));
      return;
    }

    const timer = setTimeout(resolve, seconds * 1000);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("The request was cancelled.", "AbortError"));
    }, { once: true });
  });
}

export async function requestReport(input, options = {}) {
  validateRequest(input);
  const fetchImpl = options.fetchImpl ?? fetch;
  const wait = options.wait ?? delay;
  const decompress = options.decompress ?? decompressGzip;
  const onState = options.onState ?? (() => {});
  const signal = options.signal;
  const token = input.token.trim();
  const reportUrl = withApiVersion(
    `${API_ROOT}/${encodeURIComponent(input.tenantId)}/licensing/reports/${REPORT_NAME}`
  );

  onState({ phase: "submitting", message: "Submitting report request..." });
  const submission = await apiFetch(fetchImpl, reportUrl, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      startDate: input.startDate,
      endDate: input.endDate,
      granularity: input.granularity
    }),
    signal
  });

  if (submission.status !== 202) {
    throw await createResponseError(submission, "The report request was rejected.");
  }

  let operationUrl = withApiVersion(requireHeader(submission, "Location"));
  let retryAfter = parseRetryAfter(submission.headers.get("Retry-After"));
  let downloadUrl;
  let fileName;

  while (!downloadUrl) {
    onState({
      phase: "waiting",
      message: `Report generation is running. Next check in ${retryAfter} seconds.`,
      retryAfter
    });
    await wait(retryAfter, signal);

    const pollResponse = await apiFetch(
      fetchImpl,
      operationUrl,
      token,
      { signal }
    );
    if (!pollResponse.ok) {
      throw await createResponseError(pollResponse, "The report status could not be read.");
    }

    const operation = await readJson(pollResponse, "The report status response was not valid JSON.");
    switch (operation.status) {
      case "Running":
        retryAfter = parseRetryAfter(pollResponse.headers.get("Retry-After"));
        break;
      case "Succeeded":
        downloadUrl = withApiVersion(requireHeader(pollResponse, "Location"));
        fileName = operation.fileName;
        if (typeof fileName !== "string" || !fileName.endsWith(".csv.gz")) {
          throw new ReportingApiError("The completed operation did not return a valid .csv.gz file name.");
        }
        break;
      case "Failed":
        throw new ReportingApiError(
          `Report generation failed: ${operation.error || "No error details were returned."}`
        );
      default:
        throw new ReportingApiError(
          `The API returned an unsupported operation status: ${String(operation.status)}.`
        );
    }
  }

  onState({ phase: "downloading", message: "Downloading and reading the generated report..." });
  const downloadResponse = await apiFetch(
    fetchImpl,
    downloadUrl,
    token,
    { signal }
  );
  if (!downloadResponse.ok) {
    throw await createResponseError(downloadResponse, "The generated report could not be downloaded.");
  }

  const archive = await downloadResponse.blob();
  signal?.throwIfAborted();
  const csvText = await decompress(archive);
  signal?.throwIfAborted();
  const table = parseCsv(csvText);
  signal?.throwIfAborted();
  onState({
    phase: "complete",
    message: `Report complete. ${table.rows.length} data row${table.rows.length === 1 ? "" : "s"} loaded.`
  });

  return { archive, fileName, ...table };
}

export async function decompressGzip(blob) {
  if (typeof DecompressionStream === "undefined") {
    throw new ReportingApiError("This browser does not support gzip decompression streams.");
  }

  try {
    const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  } catch (error) {
    throw new ReportingApiError("The downloaded report was not a valid gzip file.", { cause: error });
  }
}

export function parseCsv(text) {
  const input = text.replace(/^\uFEFF/, "");
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        field += character;
      }
      continue;
    }

    if (closedQuote && character !== "," && character !== "\r" && character !== "\n") {
      throw new ReportingApiError("The report CSV contains characters after a closing quote.");
    }
    if (character === '"' && field.length === 0 && !closedQuote) {
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
      closedQuote = false;
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && input[index + 1] === "\n") {
        index += 1;
      }
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      closedQuote = false;
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new ReportingApiError("The report CSV contains an unterminated quoted field.");
  }
  if (field.length > 0 || record.length > 0 || closedQuote) {
    record.push(field);
    records.push(record);
  }
  if (records.at(-1)?.length === 1 && records.at(-1)[0] === "") {
    records.pop();
  }
  if (records.length === 0 || records[0].length === 0) {
    throw new ReportingApiError("The report CSV is empty.");
  }

  const [headers, ...rows] = records;
  if (headers.some((header) => header.length === 0)) {
    throw new ReportingApiError("The report CSV contains an empty column name.");
  }
  const invalidRow = rows.findIndex((row) => row.length !== headers.length);
  if (invalidRow !== -1) {
    throw new ReportingApiError(
      `The report CSV row ${invalidRow + 2} has ${rows[invalidRow].length} fields; expected ${headers.length}.`
    );
  }
  return { headers, rows };
}

async function apiFetch(fetchImpl, url, token, init) {
  try {
    return await fetchImpl(url, {
      ...init,
      redirect: "error",
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${token}`
      }
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }
    throw new ReportingApiError(
      "The API request failed. Check your network connection and the endpoint's localhost CORS policy.",
      { cause: error }
    );
  }
}

async function createResponseError(response, fallbackMessage) {
  let code;
  let message;
  try {
    const body = await response.json();
    code = body?.error?.code;
    message = body?.error?.message;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }
    message = undefined;
  }

  const detail = [code, message].filter(Boolean).join(": ");
  return new ReportingApiError(
    `${fallbackMessage} HTTP ${response.status}${detail ? ` - ${detail}` : ""}`,
    { status: response.status, code }
  );
}

async function readJson(response, message) {
  try {
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }
    throw new ReportingApiError(message, { cause: error });
  }
}

function requireHeader(response, name) {
  const value = response.headers.get(name);
  if (!value) {
    throw new ReportingApiError(`The API response did not expose the required ${name} header.`);
  }
  return value;
}

function isValidDate(value) {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}
