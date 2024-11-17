import { InstantQuery, InstantQueryResult } from "@instantdb/react"
import { DB } from "./db"

export const queryPlayersWithUserId = (userId: string) => ({
  players: {
    $: {
      where: {
        user: userId,
      },
    },
  },
});

export const queryAllPlayers = {
  players: {},
} satisfies InstantQuery<DB>;

export const queryGameData = (gameId: string) => {
  return {
    games: {
      playersOrders: {
        player: {},
      },
      rounds: {
        turns: {
          player: {},
        },
      },
      $: {
        where: {
          id: gameId,
        },
      },
    },
  } satisfies InstantQuery<DB>;
};

export const queryAllGamesWithPlayers = {
  games: { playersOrders: { player: {} } },
};

export const queryTurnsForGame = (gameId: string) => ({
  turns: {
    $: {
      where: {
        "round.game.id": gameId,
      },
    },
  },
});

export type GameDataType = InstantQueryResult<
  DB,
  ReturnType<typeof queryGameData>
>["games"];
