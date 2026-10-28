const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export function agentKey(row) {
  return row.agent.id || `${row.agent.environmentId || row.properties.environmentId || ""}/${row.agent.name}`;
}

export function agentOperationPath(operation, row) {
  const environmentId = row.properties.environmentId || row.agent.environmentId;
  // Inventory properties.name is the Dataverse bot ID; never use the ARG resource path as a bot ID.
  const botId = row.properties.name || row.agent.name;
  const values = { EnvironmentId: environmentId, BotId: botId, AgentId: botId };
  return operation.path.replace(/\{(EnvironmentId|BotId|AgentId)\}/g, (placeholder, key) =>
    typeof values[key] === "string" && values[key].trim() ? encodeURIComponent(values[key].trim()) : placeholder);
}

export function agentOperationFields(operation, row) {
  const labels = { EnvironmentId: "Environment ID", BotId: "Agent ID", AgentId: "Agent ID",
    ChannelName: "Channel", TestRunId: "Evaluation run ID", TestSetId: "Evaluation test set ID" };
  const fields = [...new Set(agentOperationPath(operation, row).match(/\{[^}]+\}/g) || [])]
    .map((placeholder) => {
      const name = placeholder.slice(1, -1);
      return { name, label: labels[name] || friendlyMetadataLabel(name), required: true,
        ...(name === "ChannelName" ? { choices: ["M365"] } : {}) };
    });
  if (operation.id === "download-agent-channel-manifest") {
    fields.push({ name: "includeAgentSchema", label: "Include agent schema", choices: ["false", "true"] });
  }
  if (operation.id === "reassign-copilot-agent") {
    fields.push({ name: "NewOwnerAadUserId", label: "New owner's Microsoft Entra user ID", required: true });
  }
  if (operation.id === "set-connector-consent-bypass") {
    fields.push({ name: "adminConsentBypass", label: "Allow connector consent bypass",
      choices: ["", "false", "true"], required: true });
  }
  if (operation.id === "run-maker-evaluation-test-set") {
    fields.push({ name: "evaluationRunName", label: "Evaluation run name" },
      { name: "mcsConnectionId", label: "Copilot Studio connection ID (blank for anonymous)" },
      { name: "runOnPublishedBot", label: "Run against", choices: ["false", "true"],
        choiceLabels: ["Draft agent", "Published agent"] });
  }
  return fields;
}

export function agentOperationRequest(operation, row, inputs = {}) {
  for (const field of agentOperationFields(operation, row)) {
    const value = inputs[field.name] ?? (field.required ? "" : field.choices?.[0] ?? "");
    if (field.required && !String(value).trim()) throw new Error(`${field.label} is required.`);
    if (field.choices && !field.choices.includes(value)) throw new Error(`Select a valid value for ${field.label}.`);
  }
  let path = agentOperationPath(operation, row).replace(/\{([^}]+)\}/g, (_placeholder, key) => {
    const value = String(inputs[key] ?? "").trim();
    if (!value || /[/\\?#{}%]/.test(value) || [".", ".."].includes(value)) throw new Error(`Enter a valid ${key}.`);
    return encodeURIComponent(value);
  });
  let body;
  if (operation.id === "reassign-copilot-agent") {
    const owner = String(inputs.NewOwnerAadUserId).trim();
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(owner)) throw new Error("Enter the new owner's Microsoft Entra user GUID.");
    body = { NewOwnerAadUserId: owner };
  } else if (operation.id === "set-connector-consent-bypass") {
    body = { adminConsentBypass: inputs.adminConsentBypass === "true" };
  } else if (operation.id === "run-maker-evaluation-test-set") {
    body = { runOnPublishedBot: inputs.runOnPublishedBot === "true" };
    for (const key of ["evaluationRunName", "mcsConnectionId"]) {
      if (inputs[key]?.trim()) body[key] = inputs[key].trim();
    }
  }
  if (operation.id === "download-agent-channel-manifest") {
    path += `?includeAgentSchema=${inputs.includeAgentSchema === "true"}`;
  }
  return { path, method: operation.method, apiVersion: operation.apiVersion, body,
    ...(operation.id.startsWith("download-") ? { responseType: "blob" } : {}) };
}

export function friendlyMetadataLabel(key) {
  const labels = {
    displayName: "Agent name", description: "Description", createdIn: "Created with",
    model: "AI model", harness: "Agent harness", orchestration: "Orchestration mode",
    authentication: "Sign-in method", isQuarantined: "Quarantined", quarantinedAt: "Quarantined on",
    createdAt: "Created on", modifiedAt: "Last updated", lastPublishedAt: "Last published",
    ownerId: "Owner ID", createdBy: "Created by", modifiedBy: "Last updated by",
    environmentId: "Environment ID", environmentName: "Environment name", schemaName: "Schema name",
    isCLIAgent: "Built with GitHub Copilot", channels: "Published channels",
    powerPlatformConnectors: "Power Platform connections", connectorId: "Connection ID",
    sharedWithViewers: "Viewer access", sharedWithEditors: "Editor access",
    userCount: "People", groupCount: "Groups", entireTenant: "Everyone in the organization",
    capabilitiesCounts: "Capability counts", entraAgentId: "Microsoft Entra agent ID",
    entraAgentBlueprintId: "Microsoft Entra blueprint ID", entraAppId: "Microsoft Entra application ID",
    id: "Resource ID", type: "Resource type", tenantId: "Tenant ID"
  };
  if (Object.hasOwn(labels, key)) return labels[key];
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").replace(/[_-]+/g, " ")
    .replace(/\b(id|url|api|ai)\b/gi, (word) => word.toUpperCase());
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function friendlyMetadataValue(key, value) {
  if (value === undefined || value === null || value === "") return "Not provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && /(?:At|Date|On)$/.test(key) &&
      /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
      .format(new Date(value));
  }
  return String(value);
}

export function agentDetailsMarkup(row, section) {
  let nextId = 0;
  const field = (key, value, label = friendlyMetadataLabel(key)) => {
    const id = `agent-metadata-${nextId++}`;
    if (value !== null && typeof value === "object") {
      let contents;
      if (Array.isArray(value)) {
        contents = value.length ? `<ol class="metadata-list">${value.map((item, index) =>
          `<li>${item !== null && typeof item === "object" ? field(key, item, `Item ${index + 1}`) :
            `<span>${escape(friendlyMetadataValue(key, item))}</span>`}</li>`).join("")}</ol>` :
          '<p class="form-hint">None listed</p>';
      } else {
        contents = Object.entries(value).map(([child, item]) =>
          field(child, item, child === "displayName" ? "Display name" : friendlyMetadataLabel(child))).join("") ||
          '<p class="form-hint">No details provided</p>';
      }
      return `<fieldset class="metadata-group"><legend>${escape(label)}</legend>${contents}</fieldset>`;
    }
    const text = friendlyMetadataValue(key, value);
    return `<div class="field"><label for="${id}">${escape(label)}</label>
      ${text.length > 120 || text.includes("\n")
        ? `<textarea id="${id}" readonly>${escape(text)}</textarea>`
        : `<input id="${id}" readonly value="${escape(text)}">`}</div>`;
  };
  const groups = [
    { title: "About this agent", keys: ["displayName", "description", "harness", "model", "createdIn", "orchestration", "isCLIAgent"] },
    { title: "Ownership and activity", keys: ["ownerId", "createdBy", "modifiedBy", "createdAt", "modifiedAt", "lastPublishedAt"] },
    { title: "Security and sharing", keys: ["authentication", "isQuarantined", "quarantinedAt", "sharedWithViewers", "sharedWithEditors"] },
    { title: "Channels and capabilities", keys: ["channels", "powerPlatformConnectors", "capabilities", "capabilitiesCounts"] }
  ];
  const assigned = new Set(groups.flatMap((group) => group.keys));
  const additional = Object.entries(row.properties).filter(([key]) => !assigned.has(key));
  const harnessName = { github: "GitHub Copilot", standard: "Standard", chat: "Copilot Chat", unknown: "Unknown" }[row.kind] || "Unknown";
  const ribbonGroups = new Map();
  section.resourceGroups.forEach((group, resourceIndex) => {
    group.operations.forEach((operation, operationIndex) => {
      const title = operation.id.includes("evaluation") ? "Evaluations" :
        group.id === "bots" ? "Agent management" : group.title;
      if (!ribbonGroups.has(title)) ribbonGroups.set(title, []);
      ribbonGroups.get(title).push({ operation, resourceIndex, operationIndex });
    });
  });
  return `<div class="hero"><h1>${escape(row.properties.displayName || row.agent.name || "Agent details")}</h1></div>
    <a class="button button-quiet" href="#section/copilot-studio">Back to agents</a>
    <section class="agent-ribbon" aria-label="Agent operations">
      <div class="ribbon-heading"><h2>Agent operations</h2><span>Run an action for this agent</span>
        <button id="cancel-agent-operation" type="button" class="button button-quiet button-small" disabled>Cancel request</button></div>
      <div class="ribbon-bands">${[...ribbonGroups].map(([title, operations]) =>
        `<div class="ribbon-group" role="group" aria-label="${escape(title)}">
          <div class="ribbon-group-label">${escape(title)}</div>
          <div class="agent-operation-buttons">${operations.map(({ operation, resourceIndex, operationIndex }) =>
            `<button type="button" class="button ${["DELETE", "POST", "PUT", "PATCH"].includes(operation.method) ? "button-danger" : "button-quiet"} agent-operation"
              data-resource-index="${resourceIndex}" data-operation-index="${operationIndex}">${escape(operation.title)}</button>`).join("")}</div>
          </div>`).join("")}</div>
      <p class="form-hint">Actions run directly for this agent. Extra values are requested only when needed. Management changes require confirmation; results appear below. Evaluation runs may continue on the service after the request finishes or is cancelled.</p>
    </section>
    <form class="agent-metadata" aria-label="Agent information">
      ${groups.map((group) => {
        const values = group.keys.filter((key) => Object.hasOwn(row.properties, key));
        if (!values.length && group.title !== "About this agent") return "";
        return `<section class="panel"><h2>${group.title}</h2><div class="metadata-fields">
          ${group.title === "About this agent" ? field("harness", harnessName, "Harness classification") : ""}
          ${values.map((key) => field(key, row.properties[key])).join("")}</div></section>`;
      }).join("")}
      <details class="panel metadata-technical"><summary>Technical details and additional information</summary>
        <div class="metadata-fields">
          ${additional.map(([key, value]) => field(key, value, key === "name" ? "Agent ID" : friendlyMetadataLabel(key))).join("")}
          ${Object.entries(row.agent).filter(([key]) => key !== "properties")
            .map(([key, value]) => field(key, value, `Inventory · ${friendlyMetadataLabel(key)}`)).join("")}
          ${field("source", row.source === "properties.harness" ? "Reported by agent inventory" : row.source, "Harness classification source")}
        </div></details>
    </form>`;
}
