import { BleClient } from "@capacitor-community/bluetooth-le";
import type { ScanResult } from "@capacitor-community/bluetooth-le";
import { registerPlugin } from "@capacitor/core";
import { osVersion, platform } from "./platform";

// Tables nearby, over Bluetooth LE: the host's phone advertises the Whist
// table service (our TableNearby plugin: ios/App/App/TableNearbyPlugin.swift,
// android/.../TableNearbyPlugin.java) and serves one characteristic,
// {"g": gameId, "n": host's name}; other phones scan for the service with
// @capacitor-community/bluetooth-le, connect and read it. Loaded only in the
// mobile build (see nearby.ts).
export const SERVICE = "e62c7db0-f38e-4db6-8651-aa677b9ea2c8";
export const TABLE = "3ccf0d62-8326-4755-9836-e4f29387516d";

const TableNearby = registerPlugin<{
  startHosting(o: { gameId: string; name: string }): Promise<void>;
  stopHosting(): Promise<void>;
}>("TableNearby");

export type Table = { deviceId: string; gameId: string; name: string };

export class NearbyError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

const MESSAGES: Record<string, string> = {
  off: "Turn on Bluetooth to use tables nearby.",
  location:
    "Turn on Location to find tables nearby (Android 11 and older need it).",
  unauthorized: "Allow Bluetooth for Whist in Settings to use tables nearby.",
  unsupported: "This phone can't use tables nearby.",
  failed: "Couldn't use Bluetooth. Try again.",
};

// The plugins' errors in plain words. Ours carry a code; the scanning
// plugin's only a message.
function explain(error: unknown): NearbyError {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && MESSAGES[code])
    return new NearbyError(MESSAGES[code], code);
  const text = String((error as Error | null)?.message ?? error).toLowerCase();
  const guess = /permission|denied|unauthori[sz]ed|not allowed/.test(text)
    ? "unauthorized"
    : /disabled|not enabled|powered off|turned off/.test(text)
    ? "off"
    : /not available|unsupported|not supported/.test(text)
    ? "unsupported"
    : "failed";
  return new NearbyError(MESSAGES[guess], guess);
}

// Advertises this table until the returned function is called.
export async function host(gameId: string, name: string) {
  try {
    await TableNearby.startHosting({ gameId, name });
  } catch (error) {
    throw explain(error);
  }
  return () => {
    TableNearby.stopHosting().catch(() => {});
  };
}

let initialized: Promise<void> | undefined;

const decoder = new TextDecoder();
function parse(view: DataView): { gameId: string; name: string } | undefined {
  try {
    const json = JSON.parse(
      decoder.decode(
        new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
      )
    );
    if (typeof json.g !== "string" || !/^[\w-]{1,64}$/.test(json.g))
      return undefined;
    return {
      gameId: json.g,
      name: typeof json.n === "string" ? json.n.slice(0, 40) : "",
    };
  } catch {
    return undefined;
  }
}

const RETRY_MS = 5000; // a table that couldn't be read is tried again after this

// Reports each table found until the returned function is called. Phones are
// read one at a time (connect, read, disconnect): connecting to several at
// once is unreliable, on iOS especially.
export async function scan(onTable: (table: Table) => void) {
  initialized ??= BleClient.initialize({ androidNeverForLocation: true });
  try {
    await initialized;
    if (!(await BleClient.isEnabled()))
      throw new NearbyError(MESSAGES.off, "off");
    // Before Android 12, scans find nothing while Location is off.
    if (
      platform() === "android" &&
      osVersion() < 12 &&
      !(await BleClient.isLocationEnabled())
    )
      throw new NearbyError(MESSAGES.location, "location");
  } catch (error) {
    initialized = undefined;
    throw error instanceof NearbyError ? error : explain(error);
  }
  // deviceId -> "done", or when reading it last failed.
  const tried = new Map<string, "done" | "reading" | number>();
  const queue: string[] = [];
  let busy = false;
  let stopped = false;

  const readNext = async () => {
    if (busy || stopped) return;
    const deviceId = queue.shift();
    if (!deviceId) return;
    busy = true;
    try {
      await BleClient.connect(deviceId, undefined, { timeout: 8000 });
      const table = parse(
        await BleClient.read(deviceId, SERVICE, TABLE, { timeout: 5000 })
      );
      tried.set(deviceId, "done");
      if (table && !stopped) onTable({ deviceId, ...table });
    } catch {
      tried.set(deviceId, Date.now());
    } finally {
      BleClient.disconnect(deviceId).catch(() => {});
      busy = false;
      void readNext();
    }
  };

  const found = ({ device: { deviceId } }: ScanResult) => {
    const before = tried.get(deviceId);
    if (
      before === "done" ||
      before === "reading" ||
      (typeof before === "number" && Date.now() - before < RETRY_MS)
    )
      return;
    tried.set(deviceId, "reading");
    queue.push(deviceId);
    void readNext();
  };

  try {
    // Duplicates, so a phone that failed to read is seen again later.
    await BleClient.requestLEScan(
      { services: [SERVICE], allowDuplicates: true },
      found
    );
  } catch (error) {
    throw explain(error);
  }
  return () => {
    stopped = true;
    BleClient.stopLEScan().catch(() => {});
  };
}
