import { InstantEntity } from "@instantdb/react";
import { DB } from "./db";

export type Stage = "bid" | "score";
// export type Schema = {
//   games: Game; //[];
//   players: Player; //[];
//   turns: Turn; //[];
//   rounds: Round; //[];
//   playersOrders: PlayersOrders; //[];
//   $users: User; //[];
// };

export type Game = InstantEntity<
  DB,
  "games",
  { playersOrders: { player: {} } }
>;
export type Turn = InstantEntity<DB, "turns", { round: {}; player: {} }>;
export type Round = InstantEntity<DB, "rounds", { turns: { player: {} } }>;
export type Player = InstantEntity<DB, "players">;
export type PlayersOrders = InstantEntity<DB, "playersOrders", { player: {} }>;
export type User = InstantEntity<DB, "$users">;
// export type Game = {
//   createdAt: string;
//   id: string;
//   rounds: Round[]; //[];
//   initialDealerId: string;
//   playersOrders: PlayersOrders[]; //[];
//   deletedAt: string | null;
//   createdBy?: string;
// };

// export type Turn = {
//   id: string;
//   bid?: number | null;
//   score?: number | null;
//   round: Round;
//   player: Player;
// };
// export type Round = {
//   id: string;
//   roundNumber: number;
//   game: Game;
//   turns: Turn[]; //[];
// };
// // export type Scoresheet = Round//[];
// export type Player = {
//   id: string;
//   name: string;
//   // playersOrders: PlayersOrders[]; //[];
//   user?: User;
//   isLinked: boolean;
// };

// export type PlayersOrders = {
//   id: string;
//   orderNumber: number;
//   player: Player[];
//   game: Game;
// };

// export type User = {
//   id: string;
//   player?: Player;
// };

export type Deal = {
  id: number;
  num_cards: number;
  suit_colour: string;
  suit: string;
};
