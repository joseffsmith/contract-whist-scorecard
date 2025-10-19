import { id } from "@instantdb/react";
import UpdateIcon from "@mui/icons-material/Update";
import {
  Avatar,
  Badge,
  ListItemDecorator,
  Tab,
  TabList,
  Tabs,
  useTheme as useMuiTheme,
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

import Add from "@mui/icons-material/Add";
import Leaderboard from "@mui/icons-material/Leaderboard";
import { Button } from "@mui/joy";
import { DEALS } from "../constants";
import { db } from "../db";
import { queryPlayersWithUserId } from "../queries";
import { addExistingPlayerToGame } from "../utils/addExistingPlayerToGame";
import { ThemeToggle } from "./ThemeToggle";

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
  const muiTheme = useMuiTheme();
  const canFitText = useMediaQuery(muiTheme.breakpoints.up("sm"));
  const route = match?.pattern.path;

  const status = db.useConnectionStatus();
  const connectionState =
    status === "connecting" || status === "opened"
      ? "authenticating"
      : status === "authenticated"
      ? "connected"
      : status === "closed"
      ? "closed"
      : status === "errored"
      ? "errored"
      : "unexpected state";

  if (isLoading) {
    return <div className="text-gray-900 dark:text-gray-100 p-4">Loading...</div>;
  }
  if (error) {
    return <div className="text-red-600 dark:text-red-400 p-4">Uh oh! {error.message}</div>;
  }

  const player = playerUser?.players[0];

  return (
    <>
      <div className="bg-gray-100 dark:bg-gray-800 fixed inset-0 pb-8 flex flex-col overscroll-y-none max-w-4xl max-h-[1000px] m-auto">
        <div className="flex items-stretch w-full">
          <div className="flex items-center">
            <Badge
              color={
                connectionState === "connected"
                  ? "success"
                  : connectionState === "authenticating"
                  ? "warning"
                  : "danger"
              }
              anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
              badgeInset={"0px 6px"}
            >
              <img
                src={img}
                alt="Logo"
                width="32"
                height="32"
                className="mx-4"
              />
            </Badge>
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
          <div className="flex items-center">
            <ThemeToggle size="md" variant="plain" />
            <Button
              size="lg"
              color="primary"
              sx={{
                whiteSpace: "nowrap",
                py: 1,
                borderRadius: 0,
                ml: 1,
              }}
              onClick={createNewGame}
              variant="plain"
            >
              <Add />
              {canFitText && "New game"}
            </Button>
          </div>
        
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
