import { DEALS } from "../constants";
import { Round, Player, Deal } from "../types";

export const getBidOptions = (
  currentRound: Round | null,
  currentRoundIdx: number,
  players: Player[],
  stage: "score" | "bid"
): { number: number; disabled: boolean }[] => {
  const all_options = [
    { number: 0, disabled: false },
    { number: 1, disabled: false },
    { number: 2, disabled: false },
    { number: 3, disabled: false },
    { number: 4, disabled: false },
    { number: 5, disabled: false },
    { number: 6, disabled: false },
    { number: 7, disabled: false },
  ];
  const turn: Deal | undefined = DEALS[currentRoundIdx];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!turn) {
    return [];
  }

  const bids_left = currentRound
    ? players.length - currentRound.turns.length
    : players.length;

  const options = all_options.filter((o) => o.number <= turn.num_cards);
  if (stage === "score") {
    return options;
  }
  if (bids_left !== 1) {
    return options;
  }

  const sum_bids = currentRound
    ? currentRound.turns.reduce((acc, turn) => {
        return acc + (turn.bid ?? 0);
      }, 0)
    : 0;

  if (turn.num_cards < sum_bids) {
    return options;
  }

  const cant_say = turn.num_cards - sum_bids;
  options.forEach((o) => {
    if (o.number === cant_say) {
      o.disabled = true;
    }
  });
  return options;
};
