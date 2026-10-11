import { describe, expect, it } from "vitest";
import { initNative, success, tap, warning } from "./native";

// Outside the mobile build the plugins are never loaded and nothing happens
// (the test environment has no window or Capacitor).
describe("on the web", () => {
  it("does nothing", () => {
    expect(() => {
      initNative();
      tap();
      success();
      warning();
    }).not.toThrow();
  });
});
