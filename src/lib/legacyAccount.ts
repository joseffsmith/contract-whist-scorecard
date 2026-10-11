// Detects a sign-in left over from the InstantDB days. InstantDB kept the
// signed-in user in IndexedDB ("instant_<appId>_<n>" → store "kv" → key
// "currentUser"); that data is still in people's browsers after we moved to
// our own backend, so we can tell who used to be signed in and explain that
// they need to create their account again.

const INSTANT_DB_PREFIX = "instant_33fdf866-9fcb-4721-a84d-ca1dba1f0ab0";

export type LegacyAccount = { email: string | null; isGuest: boolean };

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function readCurrentUser(name: string): Promise<unknown> {
  const open = indexedDB.open(name);
  // Never create or upgrade the old database.
  open.onupgradeneeded = () => open.transaction?.abort();
  const db = await request(open);
  try {
    if (!db.objectStoreNames.contains("kv")) return null;
    return await request(
      db.transaction("kv", "readonly").objectStore("kv").get("currentUser")
    );
  } finally {
    db.close();
  }
}

export async function findLegacyAccount(): Promise<LegacyAccount | null> {
  try {
    if (typeof indexedDB === "undefined" || !indexedDB.databases) return null;
    const dbs = await indexedDB.databases();
    for (const { name } of dbs) {
      if (!name?.startsWith(INSTANT_DB_PREFIX)) continue;
      let user = await readCurrentUser(name);
      if (typeof user === "string") user = JSON.parse(user);
      if (!user || typeof user !== "object") continue;
      const u = user as { email?: unknown; isGuest?: unknown; type?: unknown };
      if (!("email" in u) && !("isGuest" in u) && !("type" in u)) continue;
      return {
        email: typeof u.email === "string" ? u.email : null,
        isGuest: u.isGuest === true || u.type === "guest",
      };
    }
  } catch {
    // Old data unreadable — just don't show the notice.
  }
  return null;
}
