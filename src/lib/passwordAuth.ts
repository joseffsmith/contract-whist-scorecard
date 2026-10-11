import { useEffect, useState } from "react";
import { db } from "../db";
import { BASE_PATH } from "./paths";

// Client for the email + password service (server/auth.mjs), served from the
// same origin at /contract-whist/api.
const API = `${BASE_PATH}/api`;

export class AuthError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

async function post(path: string, body: unknown, token?: string) {
  if (!navigator.onLine) {
    throw new AuthError("You're offline. Signing in needs a connection.");
  }
  let res: Response;
  try {
    res = await fetch(API + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError("Couldn't reach the server. Check your signal.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AuthError(
      json.error ?? "Something went wrong. Try again.",
      json.code
    );
  }
  return json;
}

export async function passwordLogIn(email: string, password: string) {
  const { token } = await post("/password/login", { email, password });
  await db.auth.signInWithToken(token);
}

export async function passwordSignUp(email: string, password: string) {
  const { token } = await post("/password/signup", { email, password });
  await db.auth.signInWithToken(token);
}

export async function setPassword(password: string, refreshToken: string) {
  await post("/password/set", { password }, refreshToken);
}

// Whether the server has password sign-in switched on (it needs an Instant
// admin token). Checked once per page load; null while unknown.
let available: Promise<boolean> | null = null;
const checkAvailable = () =>
  (available ??= fetch(`${API}/health`)
    .then((r) => r.json())
    .then((j) => !!j.passwords)
    .catch(() => {
      available = null; // retry next time (e.g. was offline)
      return false;
    }));

export function usePasswordsAvailable() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    checkAvailable().then((v) => live && setOn(v));
    return () => {
      live = false;
    };
  }, []);
  return on;
}
