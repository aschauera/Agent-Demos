import { getSectionById } from "./api-catalog.js";
import { requestPowerPlatformApi } from "./api-client.js";
import { RESOURCE_QUERY_SAMPLES } from "./resource-query-samples.js";

export const SAVED_QUERIES_KEY = "pp-admin.resource-queries.v1";
const clauseTypes = new Set(["where", "project", "take", "orderby", "distinct", "count", "summarize", "extend", "join"]);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value) => typeof value === "string" && Boolean(value.trim());
const isFieldList = (value) => Array.isArray(value) && value.every(isText);

export function validateResourceQuery(query) {
  if (!isObject(query) || query.TableName !== "PowerPlatformResources" || !Array.isArray(query.Clauses)) {
    throw new Error("Use a JSON query object with TableName: PowerPlatformResources and a Clauses array.");
  }
  for (const clause of query.Clauses) {
    if (!isObject(clause) || !clauseTypes.has(clause.$type)) {
      throw new Error("Each query clause needs a documented $type: where, project, take, orderby, distinct, count, summarize, extend, or join.");
    }
    if (clause.$type === "where" && (!isText(clause.FieldName) || !isText(clause.Operator) ||
        !Array.isArray(clause.Values) || clause.Values.some((value) => typeof value !== "string"))) {
      throw new Error("A where clause needs FieldName, Operator, and a string Values array.");
    }
    if (["project", "distinct"].includes(clause.$type) && (!isFieldList(clause.FieldList) || !clause.FieldList.length)) {
      throw new Error(`${clause.$type} needs a nonempty string FieldList.`);
    }
    if (clause.$type === "take" && (!Number.isSafeInteger(clause.TakeCount) || clause.TakeCount < 0)) {
      throw new Error("A take clause needs a nonnegative integer TakeCount.");
    }
    if (clause.$type === "orderby" && (!isObject(clause.FieldNamesAscDesc) ||
        !Object.keys(clause.FieldNamesAscDesc).length || Object.entries(clause.FieldNamesAscDesc).some(([key, value]) => !isText(key) || !isText(value)))) {
      throw new Error("An orderby clause needs a nonempty FieldNamesAscDesc object.");
    }
    if (clause.$type === "extend" && (!isText(clause.FieldName) || !isText(clause.Expression))) {
      throw new Error("An extend clause needs FieldName and Expression.");
    }
    if (clause.$type === "summarize") {
      const expression = clause.SummarizeClauseExpression;
      if (!isObject(expression) || !isText(expression.OperatorName) || !isText(expression.OperatorFieldName) || !isFieldList(expression.FieldList)) {
        throw new Error("A summarize clause needs OperatorName, OperatorFieldName, and FieldList inside SummarizeClauseExpression.");
      }
    }
    if (clause.$type === "join") {
      if (!isText(clause.JoinKind) || !isText(clause.LeftColumnName) || !isText(clause.RightColumnName)) {
        throw new Error("A join clause needs JoinKind, LeftColumnName, RightColumnName, and a query RightTable.");
      }
      validateResourceQuery(clause.RightTable);
    }
  }
  if (query.Options !== undefined) {
    if (!isObject(query.Options)) throw new Error("Query Options must be an object.");
    const { Top, Skip, SkipToken } = query.Options;
    if (Top !== undefined && (!Number.isSafeInteger(Top) || Top < 1 || Top > 1000)) {
      throw new Error("Options.Top must be an integer from 1 to 1000.");
    }
    if (Skip !== undefined && (!Number.isSafeInteger(Skip) || Skip < 0)) throw new Error("Options.Skip must be a nonnegative integer.");
    if (SkipToken !== undefined && typeof SkipToken !== "string") throw new Error("Options.SkipToken must be a string.");
  }
  return query;
}

export function parseResourceQuery(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("Enter a resource query before executing or saving.");
  let query;
  try {
    query = JSON.parse(text);
  } catch (error) {
    throw new Error(`The query is not valid JSON: ${error.message}`, { cause: error });
  }
  return validateResourceQuery(query);
}

export async function executeResourceQuery(query, options) {
  validateResourceQuery(query);
  options.signal?.throwIfAborted();
  const section = getSectionById("resource-query");
  const operation = section.resourceGroups.flatMap((group) => group.operations).find((item) => item.id === "query-resources");
  if (!operation) throw new Error("The documented Resource Query operation is missing.");
  const response = await requestPowerPlatformApi({ ...options, section, ...operation, body: query });
  options.signal?.throwIfAborted();
  return response;
}

export function resourceQueryPage(response) {
  const body = response.data;
  if (!isObject(body) || !Array.isArray(body.data)) throw new Error("Resource Query returned no valid result rows.");
  if (body.count !== undefined && (!Number.isSafeInteger(body.count) || body.count !== body.data.length)) {
    throw new Error("Resource Query returned an inconsistent row count.");
  }
  if (body.totalRecords !== undefined && (!Number.isSafeInteger(body.totalRecords) || body.totalRecords < body.data.length)) {
    throw new Error("Resource Query returned an invalid total record count.");
  }
  if (body.skipToken != null && typeof body.skipToken !== "string") throw new Error("Resource Query returned an invalid continuation token.");
  const truncated = [true, 0, "0", "true"].includes(body.resultTruncated);
  return {
    rows: body.data, raw: body, totalRecords: body.totalRecords, nextToken: body.skipToken || undefined,
    incomplete: truncated && !body.skipToken, status: response.status
  };
}

export function queryFolder(folder = "") {
  if (typeof folder !== "string") throw new Error("Enter a folder path as text.");
  if (!folder.trim()) return "";
  const parts = folder.split("/").map((part) => part.trim());
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Use folder names separated by /, without empty, . or .. segments.");
  }
  return parts.join("/");
}

function savedQuery(record) {
  if (!isObject(record) || typeof record.id !== "string" || !record.id ||
      typeof record.name !== "string" || !record.name.trim() ||
      typeof record.updatedAt !== "string" || !Number.isFinite(Date.parse(record.updatedAt))) {
    throw new Error("The saved query library contains an invalid query record.");
  }
  parseResourceQuery(record.text);
  return { id: record.id, name: record.name.trim(), folder: queryFolder(record.folder), text: record.text, updatedAt: record.updatedAt };
}

export function readSavedQueries(storage) {
  const value = storage.getItem(SAVED_QUERIES_KEY);
  if (value === null) return [];
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("The saved query library must contain a query list.");
  const records = parsed.map(savedQuery);
  if (new Set(records.map((record) => record.id)).size !== records.length) {
    throw new Error("The saved query library contains duplicate query IDs.");
  }
  return records;
}

export function saveResourceQuery(storage, { id, name, folder, text }, {
  createId = () => crypto.randomUUID(), now = () => new Date().toISOString()
} = {}) {
  parseResourceQuery(text);
  if (typeof name !== "string" || !name.trim()) throw new Error("Enter a name for the saved query.");
  const records = readSavedQueries(storage);
  const normalizedFolder = queryFolder(folder);
  const index = id === undefined ? -1 : records.findIndex((record) => record.id === id);
  if (id !== undefined && index < 0) throw new Error("This saved query was removed. Use Save as new instead.");
  if (records.some((record) => record.id !== id && record.name === name.trim() && record.folder === normalizedFolder)) {
    throw new Error("A query with that name already exists in this folder. Choose another name.");
  }
  const record = savedQuery({ id: id ?? createId(), name, folder: normalizedFolder, text, updatedAt: now() });
  if (index < 0 && records.some((item) => item.id === record.id)) throw new Error("A saved query already uses the generated ID.");
  if (index < 0) records.push(record);
  else records[index] = record;
  storage.setItem(SAVED_QUERIES_KEY, JSON.stringify(records));
  return record;
}

export function deleteResourceQuery(storage, id) {
  const records = readSavedQueries(storage);
  if (!records.some((record) => record.id === id)) throw new Error("This saved query no longer exists.");
  storage.setItem(SAVED_QUERIES_KEY, JSON.stringify(records.filter((record) => record.id !== id)));
}

export function resourceQueryTree(saved) {
  const samples = { id: "learn", label: "Microsoft Learn", children: [] };
  const personal = { id: "saved", label: "Saved queries", children: [] };
  const groups = new Map();
  for (const query of RESOURCE_QUERY_SAMPLES) {
    if (!groups.has(query.group)) {
      const group = { id: `learn/${query.group}`, label: query.group, children: [] };
      groups.set(query.group, group);
      samples.children.push(group);
    }
    groups.get(query.group).children.push({ id: `sample/${query.id}`, label: query.name, sampleId: query.id });
  }
  const folders = new Map([["", personal]]);
  for (const query of saved) {
    let parent = personal;
    let path = "";
    for (const part of query.folder ? query.folder.split("/") : []) {
      path = path ? `${path}/${part}` : part;
      if (!folders.has(path)) {
        const node = { id: `folder/${path}`, label: part, children: [] };
        folders.set(path, node);
        parent.children.push(node);
      }
      parent = folders.get(path);
    }
    parent.children.push({ id: `saved/${query.id}`, label: query.name, savedId: query.id });
  }
  const sort = (node) => {
    node.children.sort((a, b) => Number(Boolean(b.children)) - Number(Boolean(a.children)) || a.label.localeCompare(b.label));
    node.children.filter((child) => child.children).forEach(sort);
  };
  sort(personal);
  return [samples, personal];
}
