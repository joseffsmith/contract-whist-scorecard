import { InstaQLEntity } from "@instantdb/react";
import { AppSchema } from "../instant.schema";

export type Stage = "bid" | "score";

export type Deal = {
  id: number;
  num_cards: number;
  suit_colour: string;
  suit: string;
};

export type Game = InstaQLEntity<AppSchema, "games">;

export type Turn = InstaQLEntity<AppSchema, "turns">;

export type Round = InstaQLEntity<AppSchema, "rounds">;

export type Player = InstaQLEntity<AppSchema, "players">;

export type PlayersOrders = InstaQLEntity<AppSchema, "playersOrders">;

export type User = InstaQLEntity<AppSchema, "$users">;

export type PlayersOrdersWithPlayers = InstaQLEntity<
  AppSchema,
  "playersOrders",
  { player: {} }
>;

export type RoundData = InstaQLEntity<
  AppSchema,
  "rounds",
  { turns: { player: {} } }
>;
