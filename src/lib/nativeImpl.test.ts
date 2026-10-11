import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ on: false }));
const plugins = vi.hoisted(() => ({
  impact: vi.fn((_: unknown) => Promise.resolve()),
  notification: vi.fn((_: unknown) => Promise.resolve()),
  setStyle: vi.fn((_: unknown) => Promise.resolve()),
  hideSplash: vi.fn(() => Promise.resolve()),
  minimize: vi.fn(() => Promise.resolve()),
  backHandler: undefined as undefined | ((e: { canGoBack: boolean }) => void),
  themeListener: undefined as undefined | (() => void),
  theme: "dark",
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => native.on },
  SystemBars: { setStyle: plugins.setStyle },
  SystemBarsStyle: { Dark: "DARK", Light: "LIGHT" },
}));
vi.mock("@capacitor/haptics", () => ({
  Haptics: { impact: plugins.impact, notification: plugins.notification },
  ImpactStyle: { Light: "LIGHT" },
  NotificationType: { Success: "SUCCESS", Warning: "WARNING" },
}));
vi.mock("@capacitor/splash-screen", () => ({
  SplashScreen: { hide: plugins.hideSplash },
}));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: (_: string, fn: (e: { canGoBack: boolean }) => void) => {
      plugins.backHandler = fn;
    },
    minimizeApp: plugins.minimize,
  },
}));
vi.mock("../theme/theme", () => ({
  resolvedTheme: () => plugins.theme,
  subscribeTheme: (fn: () => void) => {
    plugins.themeListener = fn;
  },
}));

import { closeTopLayer } from "./backStack";
import { initNative, success, tap, warning } from "./nativeImpl";

vi.mock("./backStack", () => ({ closeTopLayer: vi.fn(() => false) }));

const history = { back: vi.fn() };
const persist = vi.fn(() => Promise.resolve(true));
const root = { childElementCount: 1 };
const classes = new Set<string>();

beforeEach(() => {
  vi.clearAllMocks();
  native.on = false;
  plugins.theme = "dark";
  plugins.backHandler = plugins.themeListener = undefined;
  classes.clear();
  vi.stubGlobal("window", { history });
  vi.stubGlobal("navigator", { storage: { persist } });
  vi.stubGlobal("document", {
    documentElement: { classList: { add: (c: string) => classes.add(c) } },
    getElementById: () => root,
  });
});

describe("on the web", () => {
  it("does nothing", () => {
    tap();
    success();
    warning();
    initNative();
    expect(plugins.impact).not.toHaveBeenCalled();
    expect(plugins.notification).not.toHaveBeenCalled();
    expect(plugins.setStyle).not.toHaveBeenCalled();
    expect(classes.size).toBe(0);
  });
});

describe("in the app", () => {
  beforeEach(() => {
    native.on = true;
  });

  it("buzzes", () => {
    tap();
    success();
    warning();
    expect(plugins.impact).toHaveBeenCalledWith({ style: "LIGHT" });
    expect(plugins.notification).toHaveBeenCalledWith({ type: "SUCCESS" });
    expect(plugins.notification).toHaveBeenCalledWith({ type: "WARNING" });
  });

  it("survives a failing plugin", async () => {
    plugins.impact.mockReturnValueOnce(Promise.reject(new Error("no")));
    tap();
    await Promise.resolve();
  });

  it("marks the page, follows the theme and hides the splash", async () => {
    initNative();
    await Promise.resolve();
    await Promise.resolve();
    expect(classes.has("native")).toBe(true);
    expect(plugins.setStyle).toHaveBeenLastCalledWith({ style: "DARK" });
    plugins.theme = "light";
    plugins.themeListener!();
    expect(plugins.setStyle).toHaveBeenLastCalledWith({ style: "LIGHT" });
    expect(plugins.hideSplash).toHaveBeenCalledTimes(1);
  });

  it("asks for persistent storage", () => {
    initNative();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("closes an open sheet before going back", () => {
    initNative();
    vi.mocked(closeTopLayer).mockReturnValueOnce(true);
    plugins.backHandler!({ canGoBack: true });
    expect(history.back).not.toHaveBeenCalled();
  });

  it("goes back, or minimises from the first screen", () => {
    initNative();
    plugins.backHandler!({ canGoBack: true });
    expect(history.back).toHaveBeenCalledTimes(1);
    plugins.backHandler!({ canGoBack: false });
    expect(plugins.minimize).toHaveBeenCalledTimes(1);
  });
});
