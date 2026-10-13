import { platform } from "./platform";
import type { Table } from "./nearbyImpl";

// Tables nearby (phase 4): only in the native app, where Bluetooth is
// available. The plugins are loaded only in the mobile build; on the web the
// condition is a constant, so nearbyImpl and its chunk are left out.
export type { Table };

const impl =
  import.meta.env.MODE === "mobile" ? () => import("./nearbyImpl") : undefined;

export const nearbySupported = () => !!impl && platform() !== "web";

// Advertises this game to phones nearby; resolves to a function that stops.
// Rejects with a message fit to show (Bluetooth off, not allowed, ...).
export const hostTable = (gameId: string, name: string) =>
  impl
    ? impl().then((m) => m.host(gameId, name))
    : Promise.reject(new Error("Not available here."));

// Reports the tables nearby as they're found; resolves to a function that stops.
export const scanTables = (onTable: (table: Table) => void) =>
  impl
    ? impl().then((m) => m.scan(onTable))
    : Promise.reject(new Error("Not available here."));
