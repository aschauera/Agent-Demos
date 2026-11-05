import { OVERVIEW_QUERIES } from "./tenant-overview.js";

export const INVENTORY_QUERY_REFERENCE = "https://learn.microsoft.com/en-us/power-platform/admin/inventory-api";
export const INVENTORY_SCHEMA_REFERENCE = "https://learn.microsoft.com/en-us/power-platform/admin/inventory-schema";

const whereType = (type) => ({ $type: "where", FieldName: "type", Operator: "==", Values: [`'${type}'`] });
const sample = (id, name, group, clauses, source) => ({
  id, name, group, source,
  query: { TableName: "PowerPlatformResources", Clauses: clauses, Options: { Top: 1000 } }
});
const resourceTypes = [
  ["canvas-apps", "Canvas apps", "microsoft.powerapps/canvasapps"],
  ["model-driven-apps", "Model-driven apps", "microsoft.powerapps/modeldrivenapps"],
  ["code-apps", "Code apps", "microsoft.powerapps/codeapps"],
  ["managed-apps", "Managed and App Builder apps", "microsoft.powerapps/apps"],
  ["cloud-flows", "Cloud flows", "microsoft.powerautomate/cloudflows"],
  ["agent-flows", "Agent flows", "microsoft.powerautomate/agentflows"],
  ["workflow-agent-flows", "Workflow agent flows", "microsoft.powerautomate/m365agentflows"],
  ["agents", "Copilot Studio agents", "microsoft.copilotstudio/agents"],
  ["connectors", "Connectors", "microsoft.powerplatformconnector/connectors"],
  ["environments", "Environments", "microsoft.powerplatform/environments"],
  ["environment-groups", "Environment groups", "microsoft.powerplatform/environmentgroups"]
];

export const RESOURCE_QUERY_SAMPLES = [
  sample("resources-with-environments", "Resources with environment information", "Microsoft Learn examples", [
    { $type: "extend", FieldName: "joinKey", Expression: "tolower(tostring(properties.environmentId))" },
    {
      $type: "join", JoinKind: "leftouter",
      RightTable: {
        TableName: "PowerPlatformResources",
        Clauses: [
          whereType("microsoft.powerplatform/environments"),
          { $type: "project", FieldList: [
            "joinKey = tolower(name)", "environmentName = properties.displayName", "environmentRegion = location",
            "environmentType = properties.environmentType", "isManagedEnvironment = properties.isManaged"
          ] }
        ]
      },
      LeftColumnName: "joinKey", RightColumnName: "joinKey"
    },
    { $type: "where", FieldName: "type", Operator: "in~", Values: [
      "'microsoft.powerapps/canvasapps'", "'microsoft.powerapps/modeldrivenapps'",
      "'microsoft.powerautomate/cloudflows'", "'microsoft.copilotstudio/agents'",
      "'microsoft.powerautomate/agentflows'", "'microsoft.powerapps/codeapps'", "'microsoft.powerapps/apps'"
    ] },
    { $type: "orderby", FieldNamesAscDesc: { "tostring(properties.createdAt)": "desc" } }
  ], `${INVENTORY_QUERY_REFERENCE}#example-basic-power-platform-resource-query-power-platform-admin-center-default-pattern`),
  sample("simple-canvas-apps", "Simple canvas apps query", "Microsoft Learn examples", [
    whereType("microsoft.powerapps/canvasapps"),
    { $type: "project", FieldList: ["name", "location", "properties.displayName", "properties.createdAt", "properties.environmentId"] },
    { $type: "take", TakeCount: 100 }
  ], `${INVENTORY_QUERY_REFERENCE}#example-simple-canvas-apps-query`),
  sample("environment-and-date", "Canvas apps by environment and date", "Microsoft Learn examples", [
    whereType("microsoft.powerapps/canvasapps"),
    { $type: "where", FieldName: "properties.environmentId", Operator: "==", Values: ["your-environment-id"] },
    { $type: "extend", FieldName: "createdDate", Expression: "todatetime(properties.createdAt)" },
    { $type: "where", FieldName: "createdDate", Operator: ">=", Values: ["datetime(2024-01-01)"] },
    { $type: "project", FieldList: ["name", "properties.displayName", "properties.createdAt", "properties.createdBy", "properties.ownerId"] },
    { $type: "orderby", FieldNamesAscDesc: { createdDate: "desc" } }
  ], `${INVENTORY_QUERY_REFERENCE}#example-filter-resources-by-environment-and-date-range`),
  ...resourceTypes.map(([id, name, type]) => sample(id, name, "Power Platform resource types", [
    whereType(type), { $type: "orderby", FieldNamesAscDesc: { id: "asc" } }
  ], `${INVENTORY_SCHEMA_REFERENCE}#resource-types`)),
  sample("counts-by-type-and-location", "Resource counts by type and location", "Inventory summaries", [
    { $type: "summarize", SummarizeClauseExpression: {
      OperatorName: "count", OperatorFieldName: "resourceCount", FieldList: ["type", "location"]
    } },
    { $type: "orderby", FieldNamesAscDesc: { resourceCount: "desc" } }
  ], `${INVENTORY_QUERY_REFERENCE}#example-count-power-platform-resources-by-type-and-location`),
  sample("counts-by-type", "Resource counts by type", "Inventory summaries", OVERVIEW_QUERIES.types,
    `${INVENTORY_QUERY_REFERENCE}#summarize-clause`),
  sample("top-environments", "Top environments with display names", "Inventory summaries", OVERVIEW_QUERIES.environments,
    `${INVENTORY_QUERY_REFERENCE}#join-clause`),
  sample("top-owners", "Top owners (directory object IDs)", "Inventory summaries", OVERVIEW_QUERIES.owners,
    `${INVENTORY_QUERY_REFERENCE}#summarize-clause`)
];
