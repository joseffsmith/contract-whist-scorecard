import { enqueueSnackbar } from "notistack";
import { useEffect } from "react";
import { Outlet, useLocation, useNavigate, matchPath } from "react-router-dom";
import { DEALS } from "../constants";
import { act, newId } from "../lib/dispatch";
import { useStorageHealth } from "../lib/storageHealth";
import { useMyPlayer } from "../players/account";
import { sync, useAuth, useConnectionStatus } from "../sync";
import { t } from "../theme/tokens";
import { OfflineBanner } from "./chrome/OfflineBanner";
import { Shell } from "./chrome/Shell";
import { StorageWarning } from "./chrome/StorageWarning";
import { RootHeader, RootTabId } from "./chrome/RootHeader";

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
  const connection = useConnectionStatus();
  const storageHealth = useStorageHealth();

  // Changes the server turned down after we'd already shown them locally.
  useEffect(
    () =>
      sync.onActionRejected(({ error }) =>
        enqueueSnackbar(error, { variant: "error" })
      ),
    []
  );

  const { isLoading } = useAuth();
  const { user, player: myPlayer } = useMyPlayer();

  async function createNewGame() {
    if (!user) {
      nav("/login");
      return;
    }
    if (!myPlayer) {
      enqueueSnackbar("No user linked", { variant: "error" });
      return;
    }
    const gameId = newId();
    const ok = await act("createGame", {
      gameId,
      roundIds: DEALS.map(() => newId()),
      seatId: newId(),
      playerId: myPlayer.id,
    });
    if (ok) nav("/games/" + gameId + "/manage");
  }

  const rootTab = matchRootTab(location.pathname);

  if (isLoading) {
    return (
      <Shell>
        <div style={{ padding: 20, opacity: 0.6, fontSize: 13 }}>Loading…</div>
      </Shell>
    );
  }

  return (
    <Shell>
      {storageHealth !== "ok" && <StorageWarning />}
      <OfflineBanner connection={connection} />
      {rootTab && (
        <RootHeader
          activeTab={rootTab}
          onDeal={createNewGame}
          connection={connection}
        />
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Outlet context={{ onDeal: createNewGame }} />
      </div>
    </Shell>
  );
};
