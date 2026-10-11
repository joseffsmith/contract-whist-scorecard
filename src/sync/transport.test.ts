import { describe, expect, it } from "vitest";
import type { ChangeSet } from "../../shared/types";
import { createSseParser, createTransport, isAuthResponse } from "./transport";

describe("createSseParser", () => {
  const parse = (chunks: string[]) => {
    const events: string[] = [];
    const feed = createSseParser((data) => events.push(data));
    chunks.forEach(feed);
    return events;
  };

  it("collects data lines and ignores comments and other fields", () => {
    expect(
      parse([": hello\n\n", 'event: x\nid: 4\ndata: {"a":1}\n\n', ": hb\n\n"])
    ).toEqual(['{"a":1}']);
  });

  it("handles chunks split anywhere, and CRLF", () => {
    const text = 'data: {"v":1}\r\n\r\n: hb\r\n\r\ndata: {"v":2}\r\n\r\n';
    for (let i = 1; i < text.length; i++) {
      expect(parse([text.slice(0, i), text.slice(i)])).toEqual([
        '{"v":1}',
        '{"v":2}',
      ]);
    }
  });

  it("joins multi-line data and ignores empty events", () => {
    expect(parse(["data: a\ndata: b\n\n\n\ndata:c\n\n"])).toEqual([
      "a\nb",
      "c",
    ]);
  });
});

const changeSet = (version: number): ChangeSet => ({
  version,
  puts: {},
  deletes: {},
});

function streamResponse(chunks: string[], hold = false) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        if (!hold) controller.close();
      },
    })
  );
}

describe("openStream", () => {
  it("reads change sets from a chunked stream and reports open and closed", async () => {
    const body = `: hi\n\ndata: ${JSON.stringify(changeSet(1))}\n\n`;
    const calls: string[] = [];
    let seenInit: RequestInit | undefined;
    const transport = createTransport({
      base: "/api",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push(url);
        seenInit = init;
        // Split in the middle of the JSON.
        return streamResponse([
          body.slice(0, 20),
          body.slice(20),
          `data: ${JSON.stringify(changeSet(2))}\n\n`,
        ]);
      }) as typeof fetch,
    });
    const received: number[] = [];
    const events: string[] = [];
    await new Promise<void>((resolve) =>
      transport.openStream(
        5,
        (cs) => received.push(cs.version),
        (event) => {
          events.push(event);
          if (event === "closed") resolve();
        }
      )
    );
    expect(calls).toEqual(["/api/sync/stream?since=5"]);
    expect(seenInit?.signal).toBeDefined();
    expect(received).toEqual([1, 2]);
    expect(events).toEqual(["open", "closed"]);
  });

  it("closes with an error on a bad status", async () => {
    const transport = createTransport({
      base: "/api",
      fetch: (async () =>
        new Response("bad gateway", { status: 502 })) as typeof fetch,
    });
    const error = await new Promise((resolve) =>
      transport.openStream(
        0,
        () => {},
        (event, err) => event === "closed" && resolve(err)
      )
    );
    expect((error as Error).message).toMatch(/live connection/);
  });

  it("gives up on a stream that goes quiet", async () => {
    const transport = createTransport({
      base: "/api",
      streamIdleMs: 30,
      fetch: (async () => streamResponse([": hi\n\n"], true)) as typeof fetch,
    });
    const events: string[] = [];
    await new Promise<void>((resolve) =>
      transport.openStream(
        0,
        () => {},
        (event) => {
          events.push(event);
          if (event === "closed") resolve();
        }
      )
    );
    expect(events).toEqual(["open", "closed"]);
  });

  it("stays silent when the caller closes it", async () => {
    const events: string[] = [];
    const transport = createTransport({
      base: "/api",
      fetch: (async () => streamResponse([": hi\n\n"], true)) as typeof fetch,
    });
    const handle = transport.openStream(
      0,
      () => {},
      (event) => events.push(event)
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    handle.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual(["open"]);
  });
});

describe("requests", () => {
  it("sends the bearer token and surfaces server errors", async () => {
    let auth: string | null = null;
    const transport = createTransport({
      base: "/api",
      fetch: (async (_url: string, init: RequestInit) => {
        auth = new Headers(init.headers).get("authorization");
        return new Response(
          JSON.stringify({ error: "Nope.", code: "forbidden" }),
          { status: 403 }
        );
      }) as typeof fetch,
    });
    const error = await transport
      .post("/auth/password", { password: "x" }, "tok")
      .catch((e) => e);
    expect(auth).toBe("Bearer tok");
    expect(error).toMatchObject({
      message: "Nope.",
      code: "forbidden",
      status: 403,
    });
  });

  it("treats a failed or timed-out request as a network error", async () => {
    const down = createTransport({
      base: "/api",
      fetch: (async () => {
        throw new TypeError("Failed to fetch");
      }) as typeof fetch,
    });
    expect(await down.pull(0).catch((e) => e)).toMatchObject({
      code: "network",
    });

    const hung = createTransport({
      base: "/api",
      requestTimeoutMs: 20,
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener("abort", () =>
            reject(new Error("aborted"))
          )
        )) as typeof fetch,
    });
    expect(await hung.push([], "tok").catch((e) => e)).toMatchObject({
      code: "network",
    });
  });

  it("treats HTML or wrong-shaped answers to a good status as no connection", async () => {
    const html = createTransport({
      base: "/api",
      fetch: (async () =>
        new Response("<html>wifi login</html>", {
          status: 200,
        })) as typeof fetch,
    });
    expect(await html.pull(0).catch((e) => e)).toMatchObject({
      code: "network",
    });
    expect(await html.push([], "tok").catch((e) => e)).toMatchObject({
      code: "network",
    });

    const wrong = createTransport({
      base: "/api",
      fetch: (async () => new Response("[]", { status: 200 })) as typeof fetch,
    });
    expect(await wrong.pull(0).catch((e) => e)).toMatchObject({
      code: "network",
    });
    const noToken = createTransport({
      base: "/api",
      fetch: (async () =>
        new Response('{"user":{}}', { status: 200 })) as typeof fetch,
    });
    expect(
      await noToken
        .post("/auth/login", {}, undefined, isAuthResponse)
        .catch((e) => e)
    ).toMatchObject({ code: "network" });
  });

  it("fills in maps the server leaves out", async () => {
    const transport = createTransport({
      base: "/api",
      fetch: (async () =>
        new Response('{"version":3}', { status: 200 })) as typeof fetch,
    });
    expect(await transport.pull(0)).toEqual({
      version: 3,
      puts: {},
      deletes: {},
    });
  });

  it("keeps the status of a refusal, and times pulls out like other requests", async () => {
    const refused = createTransport({
      base: "/api",
      fetch: (async () =>
        new Response(
          '{"error":"Too many requests. Slow down.","code":"rate_limited"}',
          {
            status: 429,
          }
        )) as typeof fetch,
    });
    expect(await refused.pull(0).catch((e) => e)).toMatchObject({
      status: 429,
      code: "rate_limited",
    });

    const hung = createTransport({
      base: "/api",
      requestTimeoutMs: 20,
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener("abort", () =>
            reject(new Error("aborted"))
          )
        )) as typeof fetch,
    });
    const started = Date.now();
    expect(await hung.pull(0).catch((e) => e)).toMatchObject({
      code: "network",
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
