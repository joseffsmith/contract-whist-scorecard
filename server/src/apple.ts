// Sign in with Apple: checking the identity token (a JWT) the app gets from
// Apple. It is signed with one of Apple's published keys, says who it was made
// for (our bundle id) and carries the nonce we handed out, so a token can't be
// replayed or borrowed from another app.
import { createPublicKey, verify } from "node:crypto";
import type { JsonWebKey, KeyObject } from "node:crypto";

export const APPLE_ISSUER = "https://appleid.apple.com";
const KEYS_URL = "https://appleid.apple.com/auth/keys";
const KEYS_MS = 24 * 60 * 60 * 1000; // keep Apple's keys this long
const REFETCH_MS = 60 * 1000; // an unknown key id refetches at most this often
const SKEW_S = 60; // clock difference allowed, in seconds

export type AppleClaims = {
  sub: string; // the person's stable id for our team
  email?: string; // may be a private relay address, or missing
};

// Apple's signing keys by key id, fetched when needed and cached.
export type AppleKeys = { get(kid: string): Promise<KeyObject | undefined> };

type Jwks = { keys: (JsonWebKey & { kid?: string })[] };

export function appleKeys(
  fetchKeys: () => Promise<Jwks> = () =>
    fetch(KEYS_URL, { signal: AbortSignal.timeout(10_000) }).then((r) => {
      if (!r.ok) throw new Error(`Apple keys: HTTP ${r.status}`);
      return r.json() as Promise<Jwks>;
    }),
  now: () => number = Date.now
): AppleKeys {
  let keys = new Map<string, KeyObject>();
  let fetchedAt = -Infinity;
  let pending: Promise<void> | undefined;
  const refresh = () =>
    (pending ??= fetchKeys()
      .then(({ keys: list }) => {
        const next = new Map<string, KeyObject>();
        for (const jwk of list ?? []) {
          if (jwk.kty !== "RSA" || typeof jwk.kid !== "string") continue;
          try {
            next.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }));
          } catch {
            /* skip a key we can't read */
          }
        }
        // A reply with no usable key is a fault at Apple's end: keep the old ones.
        if (!next.size) throw new Error("Apple sent no usable keys");
        keys = next;
        fetchedAt = now();
      })
      .finally(() => (pending = undefined)));
  let triedAt = -Infinity;
  return {
    // Old keys stay in use if Apple can't be reached.
    async get(kid) {
      const stale = now() - fetchedAt > KEYS_MS || !keys.has(kid);
      if (stale && (pending || now() - triedAt > REFETCH_MS)) {
        triedAt = now();
        try {
          await refresh();
        } catch (e) {
          console.error("Fetching Apple's keys failed:", e);
        }
      }
      return keys.get(kid);
    },
  };
}

const decode = (part: string) =>
  JSON.parse(Buffer.from(part, "base64url").toString()) as Record<
    string,
    unknown
  >;

// The token's claims if Apple signed it for one of `audiences` with this
// nonce and it hasn't expired; throws otherwise.
export async function verifyAppleToken(
  token: unknown,
  {
    keys,
    audiences,
    nonce,
    now = Date.now,
  }: {
    keys: AppleKeys;
    audiences: string[];
    nonce: string;
    now?: () => number;
  }
): Promise<AppleClaims> {
  if (typeof token !== "string" || token.length > 8192)
    throw new Error("not a token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("not a JWT");
  const [head, body, signature] = parts;
  const header = decode(head);
  if (header.alg !== "RS256" || typeof header.kid !== "string")
    throw new Error("unexpected algorithm");
  const key = await keys.get(header.kid);
  if (!key) throw new Error("unknown key");
  const signed = verify(
    "RSA-SHA256",
    Buffer.from(`${head}.${body}`),
    key,
    Buffer.from(signature, "base64url")
  );
  if (!signed) throw new Error("bad signature");

  const claims = decode(body);
  const at = now() / 1000;
  if (claims.iss !== APPLE_ISSUER) throw new Error("wrong issuer");
  if (typeof claims.aud !== "string" || !audiences.includes(claims.aud))
    throw new Error("wrong audience");
  if (typeof claims.exp !== "number" || claims.exp + SKEW_S < at)
    throw new Error("expired");
  if (typeof claims.iat === "number" && claims.iat - SKEW_S > at)
    throw new Error("issued in the future");
  if (claims.nonce !== nonce) throw new Error("wrong nonce");
  if (typeof claims.sub !== "string" || !claims.sub)
    throw new Error("no subject");
  return {
    sub: claims.sub,
    ...(typeof claims.email === "string" ? { email: claims.email } : {}),
  };
}
