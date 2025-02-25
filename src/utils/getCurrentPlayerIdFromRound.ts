import { Player, RoundData, Turn } from "../types";

export const getCurrentPlayerIdFromRound = (
  round: RoundData | null,
  dealerIdx: number | null,
  ps: (Player | undefined)[]
): string | null => {
  if (dealerIdx === null) {
    return ps[0]!.id;
  }
  const startingPlayerIdx = (dealerIdx + 1) % ps.length;

  const orderedPlayers = [
    ...ps.slice(startingPlayerIdx),
    ...ps.slice(0, startingPlayerIdx),
  ];

  if (!round) {
    return orderedPlayers[0]!.id;
  }

  const playerId =
    orderedPlayers.find((p) => {
      const turn = round.turns.find((t) => t.player?.id === p!.id) as
        | Turn
        | undefined;
      return turn?.bid === undefined || turn.bid === null;
    }) ??
    orderedPlayers.find((p) => {
      const turn = round.turns.find((t) => t.player?.id === p!.id) as
        | Turn
        | undefined;

      return turn?.score === undefined || turn.score === null;
    }) ??
    null ??
    null;

  return playerId?.id ?? null;
};
