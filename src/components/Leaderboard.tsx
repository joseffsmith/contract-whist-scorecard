import { Sheet, Table } from "@mui/joy";
import { db } from "../db";

export const Leaderboard = () => {
  // query where game is not deleted
  const query = {
    players: {
      playersOrders: {
        $: {
          where: {
            "game.deletedAt": "",
          },
        },
      },
      turns: {
        round: {
          game: {},
        },
        $: {
          where: {
            "round.roundNumber": 12,
          },
        },
      },
    },
  };

  const { isLoading, error, data } = db.useQuery(query);

  return (
    <Sheet sx={{ overflow: "auto" }}>
      <Table
        size="sm"
        borderAxis="bothBetween"
        stickyHeader
        stripe={"even"}
        sx={{
          overflow: "auto",
          "& tr > td:not(:first-of-type)": { textAlign: "right" },
          "& thead th": {
            whiteSpace: "nowrap",
            textOverflow: "unset",
            overflowX: "visible",
            textAlign: "center",
            // width: "100px",
          },
          "& tr > *:first-of-type": {
            position: "sticky",
            left: 0,
            boxShadow: "1px 0 var(--TableCell-borderColor)",
            bgcolor: "background.surface",
          },
        }}
      >
        <thead>
          <tr>
            {/* player.name */}
            <th>player</th>
            {/* player.playersOrders.length */}
            <th>games</th>

            {/* player.turns where turn.round.roundNumber = 12 */}
            <th>games fin</th>

            {/* games where that player had the highest score */}

            {/* <th>wins</th>
            <th>total score</th>
            <th>avg score</th>
            <th>avg score per hand</th>
            <th>% of possible scores</th>
            <th>% of possible wins</th> */}
          </tr>
          {/* me? how do we link */}
          {/* <td></td> */}
        </thead>
        <tbody>
          {data?.players ? (
            data.players
              .filter((p) => p.playersOrders.length > 0)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((player) => {
                return (
                  <tr key={player.id}>
                    <td>{player.name}</td>
                    <td>{player.playersOrders.length}</td>
                    <td>{player.turns.length}</td>
                  </tr>
                );
              })
          ) : (
            <tr>
              <td colSpan={8}>Loading...</td>
            </tr>
          )}
        </tbody>
      </Table>
    </Sheet>
  );
};
