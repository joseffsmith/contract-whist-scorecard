// contract-whist-scoreboard
// https://instantdb.com/dash?s=main&t=home&app=33fdf866-9fcb-4721-a84d-ca1dba1f0ab0

import { i } from "@instantdb/react";

const graph = i.graph(
  "33fdf866-9fcb-4721-a84d-ca1dba1f0ab0",
  {
    $users: i.entity({
      email: i.any().unique(),
    }),
    games: i.entity({
      createdAt: i.any(),
      createdBy: i.any(),
      deletedAt: i.any(),
      initialDealerId: i.any(),
      initialPlayerId: i.any(),
    }),
    players: i.entity({
      name: i.any(),
    }),
    playersOrders: i.entity({
      orderNumber: i.any(),
    }),
    rounds: i.entity({
      roundNumber: i.any(),
    }),
    turns: i.entity({
      bid: i.any(),
      score: i.any(),
    }),
  },
  {
    playersTurns: {
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
    playersOrdersGame: {
      forward: {
        on: "playersOrders",
        has: "one",
        label: "game",
      },
      reverse: {
        on: "games",
        has: "many",
        label: "playersOrders",
      },
    },
    playersOrdersPlayer: {
      forward: {
        on: "playersOrders",
        has: "one",
        label: "player",
      },
      reverse: {
        on: "players",
        has: "many",
        label: "playersOrders",
      },
    },
    roundsGame: {
      forward: {
        on: "rounds",
        has: "one",
        label: "game",
      },
      reverse: {
        on: "games",
        has: "many",
        label: "rounds",
      },
    },
    roundsTurns: {
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
  }
);

export default graph;
