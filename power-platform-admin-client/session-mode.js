export function connectionPresentation(mode, token, expiresAt, now = Date.now()) {
  const connected = mode === "live" && Boolean(token) && Number.isFinite(expiresAt) && expiresAt > now;
  return {
    connected,
    label: mode === "mock" ? "Mock data · Offline" : connected ? "Connected" : "Not connected",
    description: mode === "mock" ? "Local sample data; no tenant API calls." :
      connected ? "Live tenant connected." : "Live tenant selected; sign in to connect."
  };
}

export function createMockFetch() {
  return async (input, { method = "GET", signal, body } = {}) => {
    signal?.throwIfAborted();
    const url = new URL(input);
    const json = (data) => new Response(JSON.stringify(data), {
      status: 200, headers: { "content-type": "application/json" }
    });
    if (method === "POST" && url.pathname === "/resourcequery/resources/query") {
      const query = JSON.parse(body);
      if (query.TableName !== "PowerPlatformResources" || JSON.stringify(query.Clauses) !== JSON.stringify([
        { $type: "where", FieldName: "type", Operator: "in~", Values: ["'microsoft.copilotstudio/agents'"] },
        { $type: "orderby", FieldNamesAscDesc: { id: "asc" } }
      ])) throw new Error("No sample data is available for this Resource Query.");
      return json({ data: [
        { id: "mock-github", name: "sample-github-agent", type: "microsoft.copilotstudio/agents",
          properties: { displayName: "Sample GitHub Copilot agent", environmentId: "mock-production", harness: "GitHub Copilot" } },
        { id: "mock-standard", name: "sample-standard-agent", type: "microsoft.copilotstudio/agents",
          properties: { displayName: "Sample Standard agent", environmentId: "mock-sandbox", isCLIAgent: false, createdIn: "Copilot Studio" } },
        { id: "mock-chat", name: "sample-chat-agent", type: "microsoft.copilotstudio/agents",
          properties: { displayName: "Sample Copilot Chat agent", environmentId: "mock-production", model: "Microsoft 365 Copilot" } },
        { id: "mock-unknown", name: "sample-unknown-agent", type: "microsoft.copilotstudio/agents",
          properties: { displayName: "Sample agent with missing harness", environmentId: "mock-sandbox" } }
      ], count: 4, totalRecords: 4, resultTruncated: 1 });
    }
    if (method !== "GET") {
      throw new Error("Mock mode is read-only. Switch to Live tenant to perform management actions.");
    }
    if (/^\/copilotstudio\/environments\/[^/]+\/bots\/[^/]+\/api\/botQuarantine$/.test(url.pathname)) {
      return json({ isBotQuarantined: false, lastUpdateTimeUtc: "2026-01-01T00:00:00Z" });
    }
    if (/^\/copilotstudio\/environments\/[^/]+\/bots\/[^/]+\/api\/connectorConsentBypass$/.test(url.pathname)) {
      return json({ adminConsentBypass: false });
    }
    if (/^\/copilotstudio\/environments\/[^/]+\/bots\/[^/]+\/api\/makerevaluation\/testsets$/.test(url.pathname)) {
      return json({ value: [{ id: "sample-test-set", name: "Sample evaluation set" }] });
    }
    if (url.pathname === "/environmentmanagement/environments") {
      return json({ value: [
        { id: "mock-production", displayName: "Sample Production", geo: "unitedstates", state: "Ready" },
        { id: "mock-sandbox", displayName: "Sample Sandbox", geo: "europe", state: "Ready" }
      ] });
    }
    if (/^\/powerapps\/environments\/[^/]+\/apps(?:\/[^/]+)?$/.test(url.pathname)) {
      const rows = [
        { name: "sample-code-app", type: "CodeApp", properties: { displayName: "Sample code application" } },
        { name: "sample-model-app", type: "ModelDrivenApp", properties: { displayName: "Sample model-driven application" } },
        { name: "sample-canvas-app", type: "CanvasApp", properties: { displayName: "Sample canvas application" } }
      ];
      return json(url.pathname.split("/").length > 5
        ? rows.find((row) => row.name === url.pathname.split("/").at(-1)) || {} : { value: rows });
    }
    if (/^\/powerpages\/environments\/[^/]+\/websites(?:\/[^/]+)?$/.test(url.pathname)) {
      const row = { id: "sample-site", name: "Sample customer portal", status: "OperationComplete", siteVisibility: "private" };
      return json(url.pathname.split("/").length > 5 ? row : { value: [row] });
    }
    if (url.pathname === "/appmanagement/applicationPackages" ||
        /^\/appmanagement\/environments\/[^/]+\/applicationPackages$/.test(url.pathname)) {
      let rows = [
        { uniqueName: "sample.sales", applicationName: "Sample Sales", publisherName: "Sample Publisher", version: "1.0", state: "Installed" },
        { uniqueName: "sample.service", applicationName: "Sample Service", publisherName: "Demo Publisher", version: "2.0", state: "InstallFailed" }
      ];
      if (url.searchParams.get("appInstallState")) {
        rows = rows.filter((row) => row.state === url.searchParams.get("appInstallState"));
      }
      return json({ value: rows });
    }
    if (/^\/appmanagement\/environments\/[^/]+\/operations\/[^/]+$/.test(url.pathname)) {
      return json({ operationId: url.pathname.split("/").at(-1), status: "Succeeded", statusMessage: "Simulated status only." });
    }
    throw new Error("No sample data is available for this operation. No tenant request was sent.");
  };
}

export async function mockConsumption(_input, { signal, onState } = {}) {
  signal?.throwIfAborted();
  onState?.({ phase: "complete", message: "Sample consumption report loaded. Not tenant data." });
  const csv = "Environment,Credits,Source\nSample Production,120,Mock\nSample Sandbox,35,Mock\n";
  const stream = new Blob([csv]).stream().pipeThrough(new CompressionStream("gzip"));
  const archive = await new Response(stream).blob();
  signal?.throwIfAborted();
  return {
    archive, fileName: "sample-consumption.csv.gz",
    headers: ["Environment", "Credits", "Source"],
    rows: [["Sample Production", "120", "Mock"], ["Sample Sandbox", "35", "Mock"]]
  };
}
