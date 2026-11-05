const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveOwnerNames(ids, { accessToken, expiresAt, fetchImpl = fetch, signal } = {}) {
  signal?.throwIfAborted();
  if (!Array.isArray(ids) || ids.length > 1000 ||
      ids.some((id) => typeof id !== "string" || !GUID.test(id.trim()))) {
    throw new Error("Owner-name resolution requires at most 1000 valid directory object IDs.");
  }
  if (!ids.length) return new Map();
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Owner names require a Microsoft Graph session. Reconnect with Resolve owner display names enabled.");
  }
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error("The owner-name session expired. Reconnect to resolve owner display names.");
  }
  const requested = new Set(ids.map((id) => id.trim().toLowerCase()));
  const response = await fetchImpl("https://graph.microsoft.com/v1.0/directoryObjects/getByIds", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [...requested] }),
    signal
  });
  signal?.throwIfAborted();
  const data = await response.json();
  signal?.throwIfAborted();
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Microsoft Graph returned no valid directory object list.");
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} — Microsoft Graph — ${data.error?.message || response.statusText || "Owner-name lookup failed."}`);
  }
  if (!Array.isArray(data.value)) throw new Error("Microsoft Graph returned no valid directory object list.");
  const names = new Map();
  for (const object of data.value) {
    if (!object || typeof object.id !== "string" || !requested.has(object.id.toLowerCase()) ||
        (object.displayName != null && typeof object.displayName !== "string")) {
      throw new Error("Microsoft Graph returned an invalid owner directory object.");
    }
    if (object.displayName?.trim()) names.set(object.id.toLowerCase(), object.displayName.trim());
  }
  return names;
}
