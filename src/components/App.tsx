import { id } from "@instantdb/react";
import UpdateIcon from "@mui/icons-material/Update";
import {
  Avatar,
  ListItemDecorator,
  Tab,
  TabList,
  Tabs,
  useTheme,
} from "@mui/joy";
import useMediaQuery from "@mui/material/useMediaQuery";
import { enqueueSnackbar } from "notistack";
import {
  Link,
  matchPath,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";

import Leaderboard from "@mui/icons-material";
import Add from "@mui/icons-material/Add";
import { Button } from "@mui/joy";
import { DEALS } from "../constants";
import { db } from "../db";
import { queryPlayersWithUserId } from "../queries";
import { addExistingPlayerToGame } from "../utils/addExistingPlayerToGame";

import img from "/android-chrome-192x192.png";

export const App = () => {
  const nav = useNavigate();
  const { isLoading, user, error } = db.useAuth();

  const { isLoading: isLoadingPlayerUser, data: playerUser } = db.useQuery(
    user ? queryPlayersWithUserId(user.id) : null
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
      db.tx.games[gameId].update({
        createdAt: new Date().toISOString(),
        deletedAt: "",
        createdBy: user.id,
      }),

      ...rounds.map((round) => {
        return db.tx.rounds[round.id]
          .update({
            roundNumber: round.roundNumber,
          })
          .link({ game: gameId });
      }),
    ]);

    await addExistingPlayerToGame(gameId, playerUser.players[0].id, 0);

    nav("/games/" + gameId + "/manage");
  }

  const match = useRouteMatch(["/user", "/leaderboard", "/"]);
  const theme = useTheme();
  const canFitText = useMediaQuery(theme.breakpoints.up("sm"));
  const route = match?.pattern.path;

  if (isLoading) {
    return <div>Loading...</div>;
  }
  if (error) {
    return <div>Uh oh! {error.message}</div>;
  }

  const player = playerUser?.players[0];

  return (
    <>
      <div className="bg-gray-100 fixed inset-0 pb-8 flex flex-col overscroll-y-none max-w-4xl max-h-[1000px] m-auto">
        <div className="flex items-stretch w-full">
          <div className="flex items-center">
            <img src={img} alt="Logo" width="32" height="32" className="mx-4" />
          </div>
          <Tabs
            aria-label="Icon tabs"
            value={match ? route : null}
            className="flex-grow"
          >
            <TabList tabFlex={1} underlinePlacement="bottom">
              <Tab
                indicatorPlacement="top"
                variant="plain"
                color="neutral"
                component={Link}
                to={"/user"}
                value="/user"
              >
                <ListItemDecorator>
                  <Avatar>
                    {player?.name
                      .split(" ")
                      .map((i) => i[0])
                      .join("")
                      .toUpperCase()}
                  </Avatar>
                </ListItemDecorator>
                {canFitText && "Account"}
              </Tab>
              <Tab
                indicatorPlacement="top"
                variant="plain"
                color="neutral"
                component={Link}
                to={"/leaderboard"}
                value="/leaderboard"
              >
                <ListItemDecorator>
                  <Leaderboard />
                </ListItemDecorator>
                {canFitText && "Leaderboard"}
              </Tab>
              <Tab
                indicatorPlacement="top"
                variant="plain"
                color="neutral"
                component={Link}
                to={"/"}
                value="/"
              >
                <ListItemDecorator>
                  <UpdateIcon />
                </ListItemDecorator>
                {canFitText && "History"}
              </Tab>
            </TabList>
          </Tabs>
          <Button
            // variant="soft"
            size="lg"
            // px={4}
            color="primary"
            sx={{
              whiteSpace: "nowrap",
              py: 1,
              borderRadius: 0,
              // backgroundColor: "#fff",
              // borderBottom: "1px solid grey",
            }}
            onClick={createNewGame}
            variant="plain"
          >
            {/* <ListItemDecorator> */}
            <Add />
            {/* </ListItemDecorator> */}
            {canFitText && "New game"}
          </Button>
          {/* <List
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
              <ListItemButton component={Link} to={"/user"}>
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
          </List> */}
        </div>
        <Outlet />
      </div>
    </>
  );
};

function useRouteMatch(patterns: readonly string[]) {
  const { pathname } = useLocation();

  for (let i = 0; i < patterns.length; i += 1) {
    const pattern = patterns[i];
    const possibleMatch = matchPath(pattern, pathname);
    if (possibleMatch !== null) {
      return possibleMatch;
    }
  }

  return null;
}
