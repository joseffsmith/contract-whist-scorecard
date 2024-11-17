import { id, tx } from "@instantdb/react";
import AddIcon from "@mui/icons-material/Add";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import UpdateIcon from "@mui/icons-material/Update";
import {
  Avatar,
  List,
  ListItem,
  ListItemButton,
  ListItemDecorator,
} from "@mui/joy";
import { enqueueSnackbar } from "notistack";
import { useState } from "react";
import { Link, Outlet, redirect, useNavigate } from "react-router-dom";
import { db } from "..";
import { DEALS } from "../constants";
import { addExistingPlayerToGame } from "../utils/addExistingPlayerToGame";
import img from "/android-chrome-192x192.png";

export const App = () => {
  const nav = useNavigate();
  const { isLoading, user, error } = db.useAuth();
  const { isLoading: isLoadingPlayerUser, data: playerUser } = db.useQuery(
    user
      ? {
          players: {
            $: {
              where: {
                user: user?.id!,
              },
            },
          },
        }
      : null
  );

  async function createNewGame() {
    if (!user) {
      nav("/login");
      return;
    }
    if (!playerUser?.players.length) {
      console.error("No user");
      enqueueSnackbar("No user", { variant: "error" });
      return;
    }
    const gameId = id();

    const rounds = DEALS.map((deal) => {
      return { id: id(), roundNumber: deal.id };
    });

    const res = await db.transact([
      tx.games[gameId].update({
        createdAt: new Date().toISOString(),
        deletedAt: "",
        createdBy: user.id,
      }),

      ...rounds.map((round) => {
        return tx.rounds[round.id]
          .update({
            roundNumber: round.roundNumber,
          })
          .link({ game: gameId });
      }),
    ]);

    await addExistingPlayerToGame(gameId, playerUser.players[0].id, 0);

    nav("/games/" + gameId + "/manage");
  }

  if (isLoading) {
    return <div>Loading...</div>;
  }
  if (error) {
    return <div>Uh oh! {error.message}</div>;
  }

  const player = playerUser?.players[0];

  return (
    <>
      <div className="bg-gray-100 fixed inset-0 pb-8 flex flex-col overscroll-y-none max-w-4xl max-h-[800px] m-auto">
        <List
          role="menubar"
          orientation="horizontal"
          size="md"
          sx={{
            flexGrow: 0,
            width: "100%",
            justifyContent: "space-between",
            px: 4,
          }}
        >
          <ListItem>
            <img src={img} alt="Logo" width="32" height="32" />
          </ListItem>

          <ListItem role="none">
            <ListItemButton
              role="menuitem"
              component={Link}
              to={"/user"}
              aria-label="Home"
            >
              <Avatar>
                {player?.name
                  .split(" ")
                  .map((i) => i[0])
                  .join("")
                  .toUpperCase()}
              </Avatar>
            </ListItemButton>
          </ListItem>

          <ListItem>
            <ListItemButton
              role="menuitem"
              component={Link}
              to={"/leaderboard"}
            >
              <FormatListNumberedIcon />
            </ListItemButton>
          </ListItem>

          <ListItem>
            <ListItemButton role="menuitem" component={Link} to={"/"}>
              <UpdateIcon />
            </ListItemButton>
          </ListItem>
          <ListItem>
            <ListItemDecorator>
              <ListItemButton role="menuitem" onClick={createNewGame}>
                <AddIcon />
              </ListItemButton>
            </ListItemDecorator>
          </ListItem>
        </List>

        <Outlet />
      </div>
    </>
  );
};
