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

// The score for taking `tricks` on a bid.
export const scoreFor = (bid: number, tricks: number) =>
  bid === tricks ? tricks + 10 : tricks;

// Scores that follow from the tricks already entered for a round, given its
// turns in seat order (starting after the player who just scored):
// - the entries add up to all the cards: everyone left took none;
// - one player is left: they took whatever is left over;
// - otherwise, or if the entries already add up to more than the cards,
//   nothing can be worked out.
export function autoFillTricks(
  turns: TurnLike[],
  numCards: number
): { turnId: string; score: number }[] {
  const left = turns.filter(
    (turn) => !hasScore(turn) && turn.bid !== undefined && turn.bid !== null
  );
  const entered = turns
    .filter(hasScore)
    .reduce((sum, turn) => sum + tricksFromScore(turn.score!), 0);
  if (entered > numCards) return [];
  if (entered === numCards) {
    return left.map((turn) => ({
      turnId: turn.id,
      score: scoreFor(turn.bid!, 0),
    }));
  }
  if (left.length === 1 && turns.every((t) => t === left[0] || hasScore(t))) {
    return [
      { turnId: left[0].id, score: scoreFor(left[0].bid!, numCards - entered) },
    ];
  }
  return [];
}
