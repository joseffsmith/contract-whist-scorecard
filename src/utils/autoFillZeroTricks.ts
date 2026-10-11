type TurnLike = {
  id: string;
  bid?: number | null;
  score?: number | null;
};

const hasScore = (turn: TurnLike) =>
  turn.score !== undefined && turn.score !== null;

// A made bid stores tricks + 10 as the score, a missed one just the tricks.
// (Bids are at most 7, so 10 and over always means "made".)
export const tricksFromScore = (score: number) =>
  score >= 10 ? score - 10 : score;

// Once the tricks entered so far add up to the cards dealt, everyone still
// without a score made none. Returns the scores to set for them, in the order
// the turns are given: the usual rule with 0 tricks, so a bid of 0 scores 10
// and anything else 0. Returns nothing while tricks are still missing, or if
// the entries already add up to more than the cards.
export function autoFillZeroTricks(
  turns: TurnLike[],
  numCards: number
): { turnId: string; score: number }[] {
  const tricks = turns
    .filter(hasScore)
    .reduce((sum, turn) => sum + tricksFromScore(turn.score!), 0);
  if (tricks !== numCards) return [];
  return turns
    .filter(
      (turn) => !hasScore(turn) && turn.bid !== undefined && turn.bid !== null
    )
    .map((turn) => ({ turnId: turn.id, score: turn.bid === 0 ? 10 : 0 }));
}
