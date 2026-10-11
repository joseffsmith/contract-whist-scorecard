import { describe, expect, it } from "vitest";
import { start } from "./helpers";

const IOS = "capacitor://localhost";
const ANDROID = "https://localhost";

const preflight = (url: string, origin: string, route = "/sync/push") =>
  fetch(url + route, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization, content-type",
    },
  });

describe("CORS for the native apps", () => {
  it.each([IOS, ANDROID])("answers a preflight from %s", async (origin) => {
    const api = await start();
    const res = await preflight(api.url, origin);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    expect(res.headers.get("access-control-allow-methods")).toBe(
      "GET, POST, DELETE"
    );
    expect(res.headers.get("access-control-allow-headers")).toBe(
      "authorization, content-type"
    );
    expect(res.headers.get("access-control-max-age")).toBe("600");
    expect(res.headers.get("vary")).toBe("Origin");
    // Bearer auth only: no cookies, so no credentials mode.
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("labels normal responses, errors included", async () => {
    const api = await start();
    const headers = { origin: IOS };
    const ok = await fetch(api.url + "/health", { headers });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe(IOS);
    expect(ok.headers.get("vary")).toBe("Origin");

    const post = await fetch(api.url + "/auth/guest", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: "{}",
    });
    expect(post.status).toBe(200);
    expect(post.headers.get("access-control-allow-origin")).toBe(IOS);

    const denied = await fetch(api.url + "/auth/me", { headers });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("access-control-allow-origin")).toBe(IOS);
    const missing = await fetch(api.url + "/nope", { headers });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("access-control-allow-origin")).toBe(IOS);
  });

  it("labels the event stream", async () => {
    const api = await start();
    const controller = new AbortController();
    const res = await fetch(api.url + "/sync/stream?since=0", {
      signal: controller.signal,
      headers: { origin: ANDROID, accept: "text/event-stream" },
    });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("access-control-allow-origin")).toBe(ANDROID);
    expect(res.headers.get("vary")).toBe("Origin");
    controller.abort();
  });

  it("ignores other origins but still sends Vary", async () => {
    const api = await start();
    const res = await preflight(api.url, "https://evil.example");
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");

    const get = await fetch(api.url + "/health", {
      headers: { origin: "https://evil.example" },
    });
    expect(get.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("leaves requests without an Origin alone", async () => {
    const api = await start();
    const res = await fetch(api.url + "/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("only treats OPTIONS with a requested method as a preflight", async () => {
    const api = await start();
    const res = await fetch(api.url + "/health", {
      method: "OPTIONS",
      headers: { origin: IOS },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBe(IOS);
  });

  it("takes the allowed origins from CORS_ORIGINS when set", async () => {
    const api = await start({
      corsOrigins: " http://localhost:5173 ,https://whist.test,",
    });
    for (const origin of ["http://localhost:5173", "https://whist.test"]) {
      const res = await preflight(api.url, origin);
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    }
    // The setting replaces the built-in app origins.
    expect((await preflight(api.url, IOS)).status).toBe(404);
  });

  it("runs the sync flow cross-origin with a Bearer token", async () => {
    const api = await start();
    const { token } = await api.guest();
    const res = await fetch(api.url + "/auth/me", {
      headers: { origin: ANDROID, authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ANDROID);
  });
});
