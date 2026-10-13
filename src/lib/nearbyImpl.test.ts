import { beforeEach, describe, expect, it, vi } from "vitest";

const ble = vi.hoisted(() => ({
  onResult: undefined as
    | undefined
    | ((r: { device: { deviceId: string } }) => void),
  enabled: true,
  reads: {} as Record<string, string | Error>,
  connects: [] as string[],
  initialize: vi.fn(() => Promise.resolve()),
}));
const host = vi.hoisted(() => ({
  start: vi.fn((_: unknown) => Promise.resolve()),
  stop: vi.fn(() => Promise.resolve()),
}));

vi.mock("@capacitor-community/bluetooth-le", () => ({
  BleClient: {
    initialize: ble.initialize,
    isEnabled: () => Promise.resolve(ble.enabled),
    requestLEScan: (_: unknown, cb: typeof ble.onResult) => {
      ble.onResult = cb;
      return Promise.resolve();
    },
    stopLEScan: () => Promise.resolve(),
    connect: (id: string) => {
      ble.connects.push(id);
      return Promise.resolve();
    },
    read: (id: string) => {
      const value = ble.reads[id];
      if (value instanceof Error) return Promise.reject(value);
      return Promise.resolve(
        new DataView(new TextEncoder().encode(value).buffer)
      );
    },
    disconnect: () => Promise.resolve(),
  },
}));
vi.mock("@capacitor/core", () => ({
  registerPlugin: () => ({ startHosting: host.start, stopHosting: host.stop }),
}));

import { host as hostTable, scan } from "./nearbyImpl";

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  ble.enabled = true;
  ble.reads = {};
  ble.connects = [];
  vi.clearAllMocks();
});

describe("scanning for tables", () => {
  it("reads each phone once and reports good tables", async () => {
    ble.reads = {
      a: '{"g":"game-1","n":"Joe"}',
      b: "not json",
      c: '{"g":"../../etc","n":"x"}',
    };
    const found = vi.fn();
    const stop = await scan(found);
    for (const id of ["a", "a", "b", "c", "a"])
      ble.onResult!({ device: { deviceId: id } });
    await settle();
    await settle();
    expect(found.mock.calls).toEqual([
      [{ deviceId: "a", gameId: "game-1", name: "Joe" }],
    ]);
    expect(ble.connects).toEqual(["a", "b", "c"]);
    stop();
  });

  it("tries a phone again a while after a failed read", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    ble.reads = { a: new Error("timeout") };
    const found = vi.fn();
    await scan(found);
    ble.onResult!({ device: { deviceId: "a" } });
    await settle();
    ble.reads = { a: '{"g":"game-1","n":"Joe"}' };
    ble.onResult!({ device: { deviceId: "a" } }); // too soon
    await settle();
    expect(ble.connects).toEqual(["a"]);
    vi.setSystemTime(Date.now() + 6000);
    ble.onResult!({ device: { deviceId: "a" } });
    await settle();
    await settle();
    expect(found).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("says when Bluetooth is off", async () => {
    ble.enabled = false;
    await expect(scan(() => {})).rejects.toMatchObject({ code: "off" });
  });
});

describe("hosting a table", () => {
  it("explains the plugin's refusals", async () => {
    host.start.mockRejectedValueOnce({ code: "unauthorized", message: "x" });
    await expect(hostTable("g", "Joe")).rejects.toMatchObject({
      code: "unauthorized",
      message: "Allow Bluetooth for Whist in Settings to use tables nearby.",
    });
    const stop = await hostTable("g", "Joe");
    expect(host.start).toHaveBeenLastCalledWith({ gameId: "g", name: "Joe" });
    stop();
    expect(host.stop).toHaveBeenCalled();
  });
});
