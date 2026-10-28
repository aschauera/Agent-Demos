import { getSectionById } from "./api-catalog.js";
import { HttpApiError, requestNextPage, requestPowerPlatformApi } from "./api-client.js";

const section = getSectionById("app-management");
const operations = section.resourceGroups.flatMap((resource) => resource.operations);

function segment(value, label) {
  if (typeof value !== "string" || !value.trim() || /[/\\?#{}%]/.test(value) || [".", ".."].includes(value.trim())) {
    throw new TypeError(`Enter a valid ${label}, without URL separators or placeholders.`);
  }
  return encodeURIComponent(value.trim());
}

export function createAppManagementApi(options) {
  const call = (id, parameters = {}, body) => {
    const operation = operations.find((item) => item.id === id);
    const path = operation.path.replace(/\{([^}]+)\}/g, (_match, name) => segment(parameters[name], name));
    const query = new URLSearchParams();
    for (const key of ["appInstallState", "lcid"]) {
      if (parameters[key]?.trim()) query.set(key, parameters[key].trim());
    }
    return requestPowerPlatformApi({
      ...options, section, path: `${path}${query.size ? `?${query}` : ""}`,
      apiVersion: operation.apiVersion, method: operation.method, body
    });
  };
  return {
    tenantPackages: () => call("get-tenant-application-package"),
    environmentPackages: (parameters) => call("get-environment-application-package", parameters),
    install: ({ environmentId, uniqueName, payloadValue }) => {
      if (typeof payloadValue !== "string") throw new TypeError("Installation payloadValue must be a string.");
      return call("install-application-package", { environmentId, uniqueName }, { payloadValue });
    },
    status: ({ environmentId, operationId }) => {
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(operationId?.trim() ?? "")) {
        throw new TypeError("Enter a valid operation ID (GUID).");
      }
      return call("get-application-package-install-status", { environmentId, operationId });
    },
    next: (nextLink) => requestNextPage({ ...options, section, nextLink })
  };
}

export function packagePage(data) {
  if (!data || !Array.isArray(data.value) || data.value.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("The App Management API returned an invalid package collection.");
  }
  const nextLink = data["@odata.nextLink"] ?? data["@odata.nextlink"];
  if (nextLink !== undefined && typeof nextLink !== "string") {
    throw new Error("The App Management API returned an invalid next link.");
  }
  return { rows: data.value, nextLink: nextLink || undefined };
}

export function summarizePackages(rows) {
  return {
    packages: rows.length,
    publishers: new Set(rows.map((row) => row.publisherId || row.publisherName).filter(Boolean)).size,
    installed: rows.filter((row) => ["Installed", "TemplateInstalled"].includes(row.state)).length,
    inProgress: rows.filter((row) => ["InstallRequested", "Installing", "InstallScheduled", "InstallRetrying",
      "UninstallRequested", "Uninstalling"].includes(row.state)).length,
    failed: rows.filter((row) => ["InstallFailed", "UninstallFailed"].includes(row.state)).length
  };
}

export function assertInstallStatus(response) {
  const status = response.data?.status;
  if (!["NotStarted", "Running", "Succeeded", "Failed", "Canceled"].includes(status)) {
    throw new Error("The installation status response did not contain a documented status.");
  }
  if (["Failed", "Canceled"].includes(status)) {
    const error = response.data.error;
    throw new HttpApiError({
      status: response.status, code: error?.errorName || String(error?.errorCode ?? status),
      message: error?.message || response.data.statusMessage || `Installation ${status.toLowerCase()}.`,
      details: response.data
    });
  }
  return status;
}
