import { InstaQLParams } from "@instantdb/react"
import { AppSchema } from "../instant.schema"

export const queryAllPlayers = {
  players: {},
} satisfies InstaQLParams<AppSchema>;

export const queryAllGamesWithPlayers = {
  games: { playersOrders: { player: {} } },
} satisfies InstaQLParams<AppSchema>;

// Every game with seats, rounds and turns. Screens pick one game out of this
// rather than querying a game by id, so they work offline (see lib/offline.ts).
export const queryHomeGames = {
  games: {
    playersOrders: { player: {} },
    rounds: { turns: { player: {} } },
  },
} satisfies InstaQLParams<AppSchema>;
