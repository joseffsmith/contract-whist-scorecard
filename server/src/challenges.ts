// WebAuthn challenges: single-use, short-lived, kept in memory (one process).
import { randomBytes } from "node:crypto";

const CHALLENGE_MS = 5 * 60 * 1000;

export type ChallengeKind = "register" | "login";
export type ChallengeLimits = {
  register: number; // outstanding challenges of each kind, all addresses
  login: number;
  perIp: number; // outstanding challenges for one address (both kinds)
};
// Past a limit the oldest go first, so one address can't push out others'.
const LIMITS: ChallengeLimits = { register: 2000, login: 5000, perIp: 20 };

type Entry = {
  challenge: string;
  userId: string | null; // who asked, for registration
  ip: string;
  expires: number;
};

export function createChallenges(
  now: () => Date = () => new Date(),
  limits: ChallengeLimits = LIMITS
) {
  // Insertion order is age order, so the oldest entry is always first.
  const entries: Record<ChallengeKind, Map<string, Entry>> = {
    register: new Map(),
    login: new Map(),
  };
  const perIp = new Map<string, Set<string>>(); // ids, oldest first

  function remove(kind: ChallengeKind, id: string): Entry | undefined {
    const e = entries[kind].get(id);
    if (!e) return undefined;
    entries[kind].delete(id);
    const ids = perIp.get(e.ip);
    ids?.delete(id);
    if (ids && !ids.size) perIp.delete(e.ip);
    return e;
  }
  const kindOf = (id: string): ChallengeKind =>
    entries.register.has(id) ? "register" : "login";

  return {
    // Remembers `challenge` and returns the id the client sends back with it.
    put(
      kind: ChallengeKind,
      challenge: string,
      userId: string | null,
      ip: string
    ): string {
      const at = now().getTime();
      // Expired ones go, then the oldest of this kind if it has no room.
      for (const k of ["register", "login"] as const) {
        for (const [id, e] of entries[k]) {
          if (e.expires > at && (k !== kind || entries[k].size < limits[k]))
            break;
          remove(k, id);
        }
      }
      for (const id of perIp.get(ip) ?? []) {
        if ((perIp.get(ip)?.size ?? 0) < limits.perIp) break;
        remove(kindOf(id), id);
      }
      const id = randomBytes(16).toString("base64url");
      entries[kind].set(id, {
        challenge,
        userId,
        ip,
        expires: at + CHALLENGE_MS,
      });
      let ids = perIp.get(ip);
      if (!ids) perIp.set(ip, (ids = new Set()));
      ids.add(id);
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
      if (typeof id !== "string") return undefined;
      const e = remove(kind, id);
      if (!e) return undefined;
      return e.expires > now().getTime() && e.userId === userId
        ? e.challenge
        : undefined;
    },
  };
}
export type Challenges = ReturnType<typeof createChallenges>;
