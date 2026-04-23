import { DEALS } from "../constants";

type PO = { orderNumber: number; player?: { id: string; name: string } | null };
type Turn = {
  bid?: number | null;
  score?: number | null;
  player?: { id: string } | null;
};
type Round = { roundNumber: number; turns: Turn[] };

export type GameSummary = {
  isFinished: boolean;
  currentRoundIdx: number;
  totals: { id: string; name: string; score: number }[];
  leaderIdx: number;
  winnerIdx: number;
};

// Compute the active round index (first unfinished round, or last round if all done),
// running totals per player (in playersOrders order), and derived leader/winner.
export const summarizeGame = (
  playersOrders: PO[],
  rounds: Round[]
): GameSummary => {
  const orderedPOs = [...playersOrders].sort(
    (a, b) => a.orderNumber - b.orderNumber
  );
  const players = orderedPOs
    .map((po) => po.player)
    .filter((p): p is { id: string; name: string } => !!p);
  const numPlayers = players.length;
  const rs = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);

  const isFinished = rs.length === DEALS.length && rs.every((r) =>
    r.turns.length === numPlayers &&
    r.turns.every((x) => x.score !== undefined && x.score !== null)
  );

  const unfinished = rs.find(
    (r) =>
      r.turns.length !== numPlayers ||
      r.turns.some((x) => x.score === undefined || x.score === null)
  );
  const currentRoundIdx = unfinished
    ? unfinished.roundNumber
    : rs.length
    ? rs[rs.length - 1].roundNumber
    : 0;

  const totals = players.map((p) => ({
    id: p.id,
    name: p.name,
    score: rs.reduce((acc, r) => {
      const turn = r.turns.find((tt) => tt.player?.id === p.id);
      return acc + (turn?.score ?? 0);
    }, 0),
  }));

  const max = Math.max(...totals.map((x) => x.score), 0);
  const leaderIdx = totals.findIndex((x) => x.score === max);
  const winnerIdx = isFinished ? leaderIdx : -1;

  return { isFinished, currentRoundIdx, totals, leaderIdx, winnerIdx };
};
