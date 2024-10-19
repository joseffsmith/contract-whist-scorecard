export type Stage = "bid" | "score";
export type Schema = {
  games: Game; //[];
  players: Player; //[];
  turns: Turn; //[];
  rounds: Round; //[];
  playersOrders: PlayersOrders; //[];
};
export type Game = {
  created_at: string;
  id: string;
  rounds: Round[]; //[];
  initialDealerId: string;
  playersOrders: PlayersOrders[]; //[];
  deletedAt: string | null;
  createdBy?: string;
};

export type Turn = {
  id: string;
  bid?: number | null;
  score?: number | null;
  round: Round;
  player: Player[];
};
export type Round = {
  id: string;
  roundNumber: number;
  game: Game;
  turns: Turn[]; //[];
};
// export type Scoresheet = Round//[];
export type Player = {
  id: string;
  name: string;
  playersOrders: PlayersOrders[]; //[];
};

export type PlayersOrders = {
  id: string;
  orderNumber: number;
  player: Player[];
  game: Game;
};

export type Deal = {
  id: number;
  num_cards: number;
  suit_colour: string;
  suit: string;
};
