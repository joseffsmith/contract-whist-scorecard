// WebAuthn challenges: single-use, short-lived, kept in memory (one process).
import { randomBytes } from "node:crypto";

const CHALLENGE_MS = 5 * 60 * 1000;
const MAX_CHALLENGES = 5000; // oldest go first when full

export type ChallengeKind = "register" | "login";
type Entry = {
  challenge: string;
  kind: ChallengeKind;
  userId: string | null; // who asked, for registration
  expires: number;
};

export function createChallenges(now: () => Date = () => new Date()) {
  // Insertion order is age order, so the oldest entry is always first.
  const entries = new Map<string, Entry>();

  return {
    // Remembers `challenge` and returns the id the client sends back with it.
    put(kind: ChallengeKind, challenge: string, userId: string | null): string {
      const at = now().getTime();
      for (const [id, e] of entries) {
        if (e.expires > at && entries.size < MAX_CHALLENGES) break;
        entries.delete(id);
      }
      const id = randomBytes(16).toString("base64url");
      entries.set(id, { challenge, kind, userId, expires: at + CHALLENGE_MS });
      return id;
    },

    // The challenge for `id`, or undefined if it is unknown, expired, of
    // another kind or asked for by someone else. Whatever the answer, it
    // can't be used again.
    take(
      id: unknown,
      kind: ChallengeKind,
      userId: string | null
    ): string | undefined {
      const e = typeof id === "string" ? entries.get(id) : undefined;
      if (!e) return undefined;
      entries.delete(id as string);
      const ok =
        e.expires > now().getTime() && e.kind === kind && e.userId === userId;
      return ok ? e.challenge : undefined;
    },
  };
}
export type Challenges = ReturnType<typeof createChallenges>;
