// WebAuthn challenges, stateless: the "challenge id" the client holds is a
// signed token carrying the challenge, what it is for and when it expires, so
// a restart or a crowd of phones on one network can't lose anyone's. Only
// tokens already used are remembered (until they would have expired anyway).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const CHALLENGE_MS = 5 * 60 * 1000;

// "apple": the nonce for a Sign in with Apple request.
export type ChallengeKind = "register" | "login" | "apple";
// What a token vouches for.
export type Challenge = {
  challenge: string; // base64url, what the authenticator signs
  kind: ChallengeKind;
  userId: string | null; // who asked: a signed-in user, else nobody
  // Registration with no session makes a new account: its id and the
  // authenticator's user handle (base64url) are fixed here, by the server.
  newAccount?: { id: string; handle: string };
  expires: number;
};

// Where spent tokens (their signatures) are remembered until they expire.
// `add` is false if the signature was already there. The server keeps them in
// the database, so a restart can't make a used token good again.
export type SpentTokens = {
  add(signature: string, expires: number, now: number): boolean;
};

export function memorySpentTokens(): SpentTokens {
  // Oldest first.
  const used = new Map<string, number>();
  return {
    add(signature, expires, now) {
      for (const [sig, at] of used) {
        if (at > now) break;
        used.delete(sig);
      }
      if (used.has(signature)) return false;
      used.set(signature, expires);
      return true;
    },
  };
}

export function createChallenges(
  secret: Buffer,
  now: () => Date = () => new Date(),
  spent: SpentTokens = memorySpentTokens()
) {
  const sign = (body: string) =>
    createHmac("sha256", secret).update(body).digest("base64url");

  return {
    // A new random challenge and the token to hand to the client with it.
    mint(
      kind: ChallengeKind,
      userId: string | null,
      newAccount?: Challenge["newAccount"]
    ): { challenge: string; token: string } {
      const challenge = randomBytes(32).toString("base64url");
      const payload: Challenge = {
        challenge,
        kind,
        userId,
        ...(newAccount ? { newAccount } : {}),
        expires: now().getTime() + CHALLENGE_MS,
      };
      const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
      return { challenge, token: `${body}.${sign(body)}` };
    },

    // What the token vouches for, or undefined if it isn't ours, was altered,
    // has expired, is for another kind of ceremony or another user, or was
    // used before. Whatever the answer for a genuine token, it can't be used
    // again.
    take(
      token: unknown,
      kind: ChallengeKind,
      userId: string | null
    ): Challenge | undefined {
      if (typeof token !== "string") return undefined;
      const [body, signature, ...rest] = token.split(".");
      if (!body || !signature || rest.length) return undefined;
      const expected = Buffer.from(sign(body));
      const given = Buffer.from(signature);
      if (given.length !== expected.length || !timingSafeEqual(given, expected))
        return undefined;
      let payload: Challenge;
      try {
        payload = JSON.parse(Buffer.from(body, "base64url").toString());
      } catch {
        return undefined;
      }
      const at = now().getTime();
      if (payload.expires <= at || !spent.add(signature, payload.expires, at))
        return undefined;
      return payload.kind === kind && payload.userId === userId
        ? payload
        : undefined;
    },
  };
}
export type Challenges = ReturnType<typeof createChallenges>;
