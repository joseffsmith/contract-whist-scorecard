import { InstaQLParams } from "@instantdb/react"
import { AppSchema } from "../instant.schema"

export const queryPlayersWithUserId = (userId: string) => ({
  players: {
    $: {
      where: {
        $user: userId,
      },
    },
  },
});

export const queryAllPlayers = {
  players: {},
} satisfies InstaQLParams<AppSchema>;

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
  } satisfies InstaQLParams<AppSchema>;;
};

export const queryAllGamesWithPlayers = {
  games: { playersOrders: { player: {} } },
} satisfies InstaQLParams<AppSchema>;;

export const queryTurnsForGame = (gameId: string) => ({
  turns: {
    $: {
      where: {
        "round.game.id": gameId,
      },
    },
  },
});

