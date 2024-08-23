import { i } from "@instantdb/core";

const INSTANT_APP_ID = "33fdf866-9fcb-4721-a84d-ca1dba1f0ab0";

export default i.graph(
  INSTANT_APP_ID, // your apps UUID
  {
    turns: i.entity({
      bid: i.number().optional(),
      score: i.number().optional(),
    }),
    rounds: i.entity({
      roundNumber: i.number(),
    }),
    players: i.entity({
      name: i.string(),
    }),
    games: i.entity({
      created_at: i.string(),
    }),
    playersOrders: i.entity({
      orderNumber: i.number(),
    }),
  },
  {
    gameRounds: {
      forward: {
        on: "games",
        has: "many",
        label: "rounds",
      },
      reverse: {
        on: "rounds",
        has: "one",
        label: "game",
      },
    },
    gamePlayersOrders: {
      forward: {
        on: "games",
        has: "many",
        label: "playersOrders",
      },
      reverse: {
        on: "playersOrders",
        has: "one",
        label: "game",
      },
    },
    playersPlayersOrders: {
      forward: {
        on: "players",
        has: "many",
        label: "playersOrders",
      },
      reverse: {
        on: "playersOrders",
        has: "one",
        label: "player",
      },
    },
    roundTurns: {
      forward: {
        on: "rounds",
        has: "many",
        label: "turns",
      },
      reverse: {
        on: "turns",
        has: "one",
        label: "round",
      },
    },
    playerTurns: {
      forward: {
        on: "players",
        has: "many",
        label: "turns",
      },
      reverse: {
        on: "turns",
        has: "one",
        label: "player",
      },
    },
  }
);
