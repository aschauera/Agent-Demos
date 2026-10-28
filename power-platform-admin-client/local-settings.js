const storageKey = "pp-admin.connection";
const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function connectionIds(tenantId, clientId) {
  if (!guidPattern.test(tenantId) || !guidPattern.test(clientId)) {
    throw new Error("Enter valid tenant and public client application GUIDs.");
  }
  return { tenantId, clientId };
}

export function readLocalConnection(storage) {
  const saved = storage.getItem(storageKey);
  if (saved === null) return undefined;
  const { tenantId, clientId } = JSON.parse(saved);
  return connectionIds(tenantId, clientId);
}

export function saveLocalConnection(storage, ids) {
  const { tenantId, clientId } = connectionIds(ids.tenantId, ids.clientId);
  storage.setItem(storageKey, JSON.stringify({ tenantId, clientId }));
}

export function forgetLocalConnection(storage) {
  storage.removeItem(storageKey);
}
