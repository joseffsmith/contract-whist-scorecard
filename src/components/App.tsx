import { id } from "@instantdb/react";
import { enqueueSnackbar } from "notistack";
import {
  Outlet,
  useLocation,
  useNavigate,
  matchPath,
} from "react-router-dom";
import { DEALS } from "../constants";
import { db } from "../db";
import { queryPlayersWithUserId } from "../queries";
import { addExistingPlayerToGame } from "../utils/addExistingPlayerToGame";
import { Shell } from "./chrome/Shell";
import { RootHeader, RootTabId } from "./chrome/RootHeader";
import { t } from "../theme/tokens";

// Map a pathname to a root-tab id, or null if this is a deep (breadcrumb) route.
function matchRootTab(pathname: string): RootTabId | null {
  if (matchPath("/", pathname)) return "home";
  if (matchPath("/games", pathname)) return "games";
  if (matchPath("/leaderboard", pathname)) return "board";
  if (matchPath("/user", pathname)) return "you";
  return null;
}

export const App = () => {
  const nav = useNavigate();
  const location = useLocation();
  const { isLoading, user, error } = db.useAuth();
  const status = db.useConnectionStatus();
  const connection =
    status === "connecting" || status === "opened"
      ? "authenticating"
      : status === "authenticated"
      ? "connected"
      : status === "closed"
      ? "closed"
      : status === "errored"
      ? "errored"
      : "unexpected state";

  const { data: playerUser } = db.useQuery(
    user ? queryPlayersWithUserId(user.id) : null
  );

  async function createNewGame() {
    if (!user) {
      nav("/login");
      return;
    }
    if (!playerUser?.players.length) {
      enqueueSnackbar("No user linked", { variant: "error" });
      return;
    }
    const gameId = id();
    const rounds = DEALS.map((deal) => ({
      id: id(),
      roundNumber: deal.id,
    }));
    await db.transact([
      db.tx.games[gameId].update({
        createdAt: new Date().toISOString(),
        createdBy: user.id,
      }),
      ...rounds.map((round) =>
        db.tx.rounds[round.id]
          .update({ roundNumber: round.roundNumber })
          .link({ game: gameId })
      ),
    ]);
    await addExistingPlayerToGame(gameId, playerUser.players[0].id, 0);
    nav("/games/" + gameId + "/manage");
  }

  const rootTab = matchRootTab(location.pathname);

  if (isLoading) {
    return (
      <Shell>
        <div style={{ padding: 20, opacity: 0.6, fontSize: 13 }}>Loading…</div>
      </Shell>
    );
  }
  if (error) {
    return (
      <Shell>
        <div style={{ padding: 20, color: t.red, fontSize: 13 }}>
          {error.message}
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {rootTab && (
        <RootHeader
          activeTab={rootTab}
          onDeal={createNewGame}
          connection={connection}
        />
      )}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Outlet context={{ onDeal: createNewGame }} />
      </div>
    </Shell>
  );
};
