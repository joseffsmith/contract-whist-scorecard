import { i } from "@instantdb/react";

const _schema = i.schema({
  // We inferred 10 attributes!
  // Take a look at this schema, and if everything looks good,
  // run `push schema` again to enforce the types.
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed(),
    }),
    games: i.entity({
      createdAt: i.string(),
      createdBy: i.string(),
      deletedAt: i.string().optional(),
      initialDealerId: i.string().optional(),
    }),
    players: i.entity({
      name: i.string(),
    }),
    playersOrders: i.entity({
      orderNumber: i.number(),
    }),
    rounds: i.entity({
      roundNumber: i.number(),
    }),
    turns: i.entity({
      bid: i.number().optional(),
      score: i.number().optional(),
    }),
  },
  links: {
    players$user: {
      forward: {
        on: "players",
        has: "one",
        label: "$user",
      },
      reverse: {
        on: "$users",
        has: "one",
        label: "player",
      },
    },
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
  },
  // If you use presence, you can define a room schema here
  // https://www.instantdb.com/docs/presence-and-topics#typesafety
  rooms: {},
});

// This helps Typescript display nicer intellisense
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
