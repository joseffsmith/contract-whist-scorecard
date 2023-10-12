export type Stage = "bid" | "score";

export type Turn = {
  bid?: number;
  score?: number;
};

export type Round = { [playerId: string]: Turn };

export type Scoresheet = Round[];

export type Player = {
  id: number;
  name: string;
};

export type Game = {
  created_at: string;
  players: { [order: string]: { playerId: string } };
  rounds: {
    [order: string]: {
      // roundId: string;
      dealId: string;
      turns: { [order: string]: Turn };
    };
  };
};

export type Deal = {
  id: number;
  num_cards: number;
  suit_colour: string;
  suit: string;
};
