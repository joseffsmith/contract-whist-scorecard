// Turns the raw InstantDB export into rows for importSnapshot (one-off
// migration). Claims are cleared and no users come across: everyone
// re-registers and re-claims their player. Rows that don't hang together
// (a seat or turn without a player, ...) are skipped and counted.
import type {
  GameRow,
  MergeLog,
  RoundRow,
  SeatRow,
  TurnRow,
} from "../../shared/types";
import type { Snapshot } from "./db";

type Link = { id?: unknown } | { id?: unknown }[] | null | undefined;
type Obj = Record<string, unknown>;

export type ImportCounts = {
  players: number;
  games: number;
  seats: number;
  rounds: number;
  turns: number;
  skipped: {
    players: number;
    games: number;
    seats: number;
    rounds: number;
    turns: number;
  };
};

const isObj = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) ? v : undefined;
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const ids = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

// A to-one link comes back from Instant as an array of one, or an object.
function linkId(link: Link): string | undefined {
  return str(Array.isArray(link) ? link[0]?.id : link?.id);
}

export class ImportFormatError extends Error {}

// createdBy for imported games that had no creator (matches no user).
export const LEGACY_CREATOR = "legacy-import";

export function transformInstant(data: unknown): {
  snapshot: Snapshot;
  counts: ImportCounts;
} {
  if (
    !isObj(data) ||
    !Array.isArray(data.players) ||
    !Array.isArray(data.games)
  ) {
    throw new ImportFormatError("Expected { players: [...], games: [...] }.");
  }
  const skipped = { players: 0, games: 0, seats: 0, rounds: 0, turns: 0 };
  const snapshot: Snapshot = {
    players: [],
    games: [],
    seats: [],
    rounds: [],
    turns: [],
  };

  // Players. claimedBy is deliberately dropped.
  const seenPlayers = new Set<string>();
  for (const p of list(data.players)) {
    const id = str(p.id);
    const name = str(p.name);
    if (!id || !name || seenPlayers.has(id)) {
      skipped.players += 1;
      continue;
    }
    seenPlayers.add(id);
    snapshot.players.push({ id, name });
  }
  for (const p of list(data.players)) {
    const row = snapshot.players.find((r) => r.id === str(p.id));
    const into = isObj(p.mergeLog) ? str(p.mergeLog.into) : str(p.mergedInto);
    if (!row || !str(p.mergedInto) || !into || !seenPlayers.has(into)) continue;
    const log = isObj(p.mergeLog) ? p.mergeLog : {};
    const mergeLog: MergeLog = {
      into,
      seats: ids(log.playersOrders ?? log.seats),
      turns: ids(log.turns),
      dealerGames: ids(log.dealerGames),
    };
    row.mergedInto = str(p.mergedInto);
    if (str(p.mergedAt)) row.mergedAt = str(p.mergedAt);
    row.mergeLog = mergeLog;
  }

  const seenIds = new Set<string>();
  const fresh = (kind: string, id: string) => {
    if (seenIds.has(`${kind}:${id}`)) return false;
    seenIds.add(`${kind}:${id}`);
    return true;
  };

  for (const g of list(data.games)) {
    const id = str(g.id);
    const createdAt = str(g.createdAt);
    // Games from before InstantDB recorded a creator have none; nobody
    // could edit them there either, so they come across owned by nobody.
    const createdBy = str(g.createdBy) || LEGACY_CREATOR;
    if (!id || !createdAt || !fresh("games", id)) {
      skipped.games += 1;
      // Count what we are dropping with it.
      for (const s of list(g.playersOrders)) skipped.seats += s ? 1 : 0;
      for (const r of list(g.rounds)) {
        skipped.rounds += 1;
        skipped.turns += list(r.turns).length;
      }
      continue;
    }
    const game: GameRow = { id, createdAt, createdBy };
    if (str(g.deletedAt)) game.deletedAt = str(g.deletedAt);
    const dealer = str(g.initialDealerId);
    if (dealer && seenPlayers.has(dealer)) game.initialDealerId = dealer;
    snapshot.games.push(game);

    for (const s of list(g.playersOrders)) {
      const seatId = str(s.id);
      const playerId = linkId(s.player as Link);
      const order = num(s.orderNumber);
      if (
        !seatId ||
        !playerId ||
        !seenPlayers.has(playerId) ||
        order === undefined ||
        !fresh("seats", seatId)
      ) {
        skipped.seats += 1;
        continue;
      }
      snapshot.seats.push({
        id: seatId,
        gameId: id,
        playerId,
        orderNumber: order,
      } as SeatRow);
    }

    const roundNumbers = new Set<number>();
    for (const r of list(g.rounds)) {
      const roundId = str(r.id);
      const roundNumber = num(r.roundNumber);
      const turns = list(r.turns);
      if (
        !roundId ||
        roundNumber === undefined ||
        roundNumber < 0 ||
        roundNumber > 12 ||
        roundNumbers.has(roundNumber) ||
        !fresh("rounds", roundId)
      ) {
        skipped.rounds += 1;
        skipped.turns += turns.length;
        continue;
      }
      roundNumbers.add(roundNumber);
      snapshot.rounds.push({
        id: roundId,
        gameId: id,
        roundNumber,
      } as RoundRow);

      for (const t of turns) {
        const turnId = str(t.id);
        const playerId = linkId(t.player as Link);
        if (
          !turnId ||
          !playerId ||
          !seenPlayers.has(playerId) ||
          !fresh("turns", turnId)
        ) {
          skipped.turns += 1;
          continue;
        }
        const turn: TurnRow = { id: turnId, roundId, playerId };
        if (num(t.bid) !== undefined) turn.bid = num(t.bid);
        if (num(t.score) !== undefined) turn.score = num(t.score);
        snapshot.turns.push(turn);
      }
    }
  }

  const counts: ImportCounts = {
    players: snapshot.players.length,
    games: snapshot.games.length,
    seats: snapshot.seats.length,
    rounds: snapshot.rounds.length,
    turns: snapshot.turns.length,
    skipped,
  };
  return { snapshot, counts };
}
