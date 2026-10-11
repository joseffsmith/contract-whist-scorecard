import { InstaQLParams } from "@instantdb/react";
import { useMemo } from "react";
import { AppSchema } from "../../instant.schema";
import { db } from "../db";

// Everything we know about a player that helps tell people with the same
// name apart: how much they've played, when, and who with.
export type PlayerInfo = {
  id: string;
  name: string;
  claimedBy?: string;
  mergedInto?: string;
  mergedAt?: string;
  games: number;
  lastPlayed?: string;
  gameIds: Set<string>;
  // Most frequent co-players first.
  coPlayers: { id: string; name: string; count: number }[];
};

export const queryPlayerDirectory = {
  players: {
    playersOrders: {
      game: { playersOrders: { player: {} } },
    },
  },
} satisfies InstaQLParams<AppSchema>;

const one = <T>(x: T | T[] | undefined | null): T | undefined =>
  Array.isArray(x) ? x[0] : x ?? undefined;

export const normName = (s: string) =>
  s.trim().toLowerCase().replace(/\s+/g, " ");

export function usePlayerDirectory() {
  const { data, isLoading } = db.useQuery(queryPlayerDirectory);
  const directory = useMemo(() => {
    const map = new Map<string, PlayerInfo>();
    for (const p of data?.players ?? []) {
      const games = (p.playersOrders ?? [])
        .map((po) => one(po.game))
        .filter((g): g is NonNullable<typeof g> => !!g && !g.deletedAt);
      const co = new Map<string, { id: string; name: string; count: number }>();
      let lastPlayed: string | undefined;
      for (const g of games) {
        if (!lastPlayed || g.createdAt > lastPlayed) lastPlayed = g.createdAt;
        for (const po of g.playersOrders ?? []) {
          const other = one(po.player);
          if (!other || other.id === p.id) continue;
          const c = co.get(other.id) ?? {
            id: other.id,
            name: other.name,
            count: 0,
          };
          c.count += 1;
          co.set(other.id, c);
        }
      }
      map.set(p.id, {
        id: p.id,
        name: p.name,
        claimedBy: p.claimedBy,
        mergedInto: p.mergedInto,
        mergedAt: p.mergedAt,
        games: new Set(games.map((g) => g.id)).size,
        lastPlayed,
        gameIds: new Set(games.map((g) => g.id)),
        coPlayers: [...co.values()].sort((a, b) => b.count - a.count),
      });
    }
    return map;
  }, [data]);
  return { directory, isLoading };
}

// Players that are still "live" (not merged away).
export const activePlayers = (directory: Map<string, PlayerInfo>) =>
  [...directory.values()].filter((p) => !p.mergedInto);

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });

// "15 games · last 2 Oct · with Joe, Alys"
export const describePlayer = (p: PlayerInfo): string => {
  if (!p.games) return "No games yet";
  const parts = [`${p.games} game${p.games === 1 ? "" : "s"}`];
  if (p.lastPlayed) parts.push(`last ${shortDate(p.lastPlayed)}`);
  const withNames = p.coPlayers.slice(0, 2).map((c) => c.name);
  if (withNames.length) parts.push(`with ${withNames.join(", ")}`);
  return parts.join(" · ");
};

export const sharesGame = (a: PlayerInfo, b: PlayerInfo) =>
  [...a.gameIds].some((g) => b.gameIds.has(g));

// Do two names look like the same person? Exact (ignoring case/spacing),
// one is a short extension of the other ("Joe"/"Joes"), or one is just the
// other's first name ("James"/"James M"). Two different surnames or
// initials ("James M"/"James S") don't count.
export const namesLookAlike = (a: string, b: string) => {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (!short.includes(" ") && long.startsWith(short)) {
    const rest = long.slice(short.length);
    // "Joe" → "Joes" (a typo-sized tail) or "Oli" → "Oli B" (added surname).
    if (rest.length <= 1 || rest.startsWith(" ")) return true;
  }
  return false;
};

// Pairs that might be the same person and *could* be merged (never played
// in the same game, not claimed by two different accounts).
export const possibleDuplicates = (directory: Map<string, PlayerInfo>) => {
  const live = activePlayers(directory);
  const pairs: [PlayerInfo, PlayerInfo][] = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      if (!namesLookAlike(a.name, b.name)) continue;
      if (sharesGame(a, b)) continue;
      if (a.claimedBy && b.claimedBy && a.claimedBy !== b.claimedBy) continue;
      pairs.push(orderForMerge(a, b));
    }
  }
  // Exact name matches first, then by how much the pair has played.
  pairs.sort(
    (p, q) =>
      Number(normName(q[0].name) === normName(q[1].name)) -
        Number(normName(p[0].name) === normName(p[1].name)) ||
      q[0].games + q[1].games - (p[0].games + p[1].games)
  );
  // Suggest each player for merging away only once (against its best match),
  // and never offer to merge into someone who's already suggested to go.
  const away = new Set<string>();
  return pairs.filter(([keep, gone]) => {
    if (away.has(gone.id) || away.has(keep.id)) return false;
    away.add(gone.id);
    return true;
  });
};

// [keep, mergeAway]: the claimed player survives, otherwise the busier one.
export const orderForMerge = (
  a: PlayerInfo,
  b: PlayerInfo
): [PlayerInfo, PlayerInfo] => {
  if (a.claimedBy && !b.claimedBy) return [a, b];
  if (b.claimedBy && !a.claimedBy) return [b, a];
  return a.games >= b.games ? [a, b] : [b, a];
};
