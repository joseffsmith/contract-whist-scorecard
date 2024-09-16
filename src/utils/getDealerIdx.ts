export const getDealerIdx = (
  roundIdx: number | null,
  numPlayers: number,
  initialDealerIdx: number | null
): number => {
  let dealerIdx = initialDealerIdx ?? numPlayers - 1;
  if (roundIdx !== null) {
    return (roundIdx + dealerIdx) % numPlayers;
  }
  return dealerIdx;
};
