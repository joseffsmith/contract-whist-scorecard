import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { findLegacyAccount } from "./legacyAccount";

const NAME = "instant_33fdf866-9fcb-4721-a84d-ca1dba1f0ab0_6";

function seed(name: string, value: unknown) {
  return new Promise<void>((resolve, reject) => {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kv");
    open.onsuccess = () => {
      const tx = open.result.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, "currentUser");
      tx.oncomplete = () => {
        open.result.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  });
}

async function wipe() {
  for (const { name } of await indexedDB.databases()) {
    if (name) {
      await new Promise((r) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = req.onerror = req.onblocked = r;
      });
    }
  }
}

describe("findLegacyAccount", () => {
  beforeEach(wipe);

  it("returns null when there is no old InstantDB data", async () => {
    expect(await findLegacyAccount()).toBeNull();
  });

  it("finds an old email account (stored as a JSON string)", async () => {
    await seed(
      NAME,
      JSON.stringify({
        id: "u1",
        email: "oli@example.com",
        type: "user",
        isGuest: false,
      })
    );
    expect(await findLegacyAccount()).toEqual({
      email: "oli@example.com",
      isGuest: false,
    });
  });

  it("finds an old guest session (stored as an object)", async () => {
    await seed(NAME, { id: "g1", type: "guest", isGuest: true });
    expect(await findLegacyAccount()).toEqual({ email: null, isGuest: true });
  });

  it("ignores other databases and signed-out state", async () => {
    await seed("something-else", { email: "x@example.com" });
    await seed(NAME, null);
    expect(await findLegacyAccount()).toBeNull();
  });
});
