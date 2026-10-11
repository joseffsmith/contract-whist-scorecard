import type {
  GameRow,
  PlayerRow,
  RoundRow,
  SeatRow,
  TurnRow,
} from "../shared/types";

export type Stage = "bid" | "score";

export type Deal = {
  id: number;
  num_cards: number;
  suit_colour: string;
  suit: string;
};

export type Game = GameRow;

export type Turn = TurnRow;

export type Round = RoundRow;

export type Player = PlayerRow;

export type PlayersOrders = SeatRow;

export type PlayersOrdersWithPlayers = SeatRow & { player?: PlayerRow };

export type RoundData = RoundRow & {
  turns: (TurnRow & { player?: PlayerRow })[];
};
