import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// paths.ts reads import.meta.env when it loads, so import it fresh each time.
async function load(env: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  return import("./paths");
}

beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: "https://site.test" } });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the website build", () => {
  it("calls its own origin and links to itself", async () => {
    const { API_BASE, BASE_PATH, appUrl } = await load({
      BASE_URL: "/contract-whist/",
      VITE_API_BASE: "",
      VITE_PUBLIC_URL: "",
    });
    expect(BASE_PATH).toBe("/contract-whist");
    expect(API_BASE).toBe("/contract-whist/api");
    expect(appUrl("join/abc")).toBe(
      "https://site.test/contract-whist/join/abc"
    );
    expect(appUrl("/join/abc")).toBe(
      "https://site.test/contract-whist/join/abc"
    );
  });
});

describe("the mobile build", () => {
  const mobile = {
    BASE_URL: "/",
    VITE_API_BASE: "https://joseffsmith.uk/contract-whist/api",
    VITE_PUBLIC_URL: "https://joseffsmith.uk/contract-whist/",
  };

  it("calls the absolute API address", async () => {
    const { API_BASE, BASE_PATH } = await load(mobile);
    expect(BASE_PATH).toBe("");
    expect(API_BASE).toBe("https://joseffsmith.uk/contract-whist/api");
  });

  it("links to the website, not capacitor://localhost", async () => {
    vi.stubGlobal("window", { location: { origin: "capacitor://localhost" } });
    const { appUrl } = await load(mobile);
    expect(appUrl("join/abc")).toBe(
      "https://joseffsmith.uk/contract-whist/join/abc"
    );
  });
});
