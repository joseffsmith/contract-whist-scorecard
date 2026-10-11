import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { act } from "../lib/dispatch";
import { useMyPlayer } from "../players/account";
import { selectHomeGames, sync, useAuth, useSyncView } from "../sync";
import { alpha, t } from "../theme/tokens";
import { summarizeGame } from "../utils/gameStatus";
import { ThemePicker } from "./chrome/ThemeToggle";
import { AccountMovedBanner } from "./chrome/AccountMovedBanner";
import { AlsoYou } from "./AlsoYou";
import { SetPasswordSheet } from "./SetPasswordSheet";
import { LinkPlayerToMe } from "./UserLogin";

export const UserManager = () => {
  const { isLoading: isLoadingUser, user } = useAuth();
  const nav = useNavigate();
  const [passwordOpen, setPasswordOpen] = useState(false);

  const { player: linkedPlayer, isLoading: isLoadingPlayer } = useMyPlayer();
  const { view } = useSyncView();

  if (isLoadingUser) {
    return <div style={{ padding: 20, opacity: 0.6 }}>Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (isLoadingPlayer) {
    return <div style={{ padding: 20, opacity: 0.6 }}>Loading…</div>;
  }

  if (!linkedPlayer) {
    return (
      <>
        <AccountMovedBanner signedIn={!user.isGuest} />
        <LinkPlayerToMe />
      </>
    );
  }

  // Stats for this player
  let games = 0,
    finished = 0,
    wins = 0,
    total = 0;
  for (const g of selectHomeGames(view).games) {
    if (g.deletedAt) continue;
    const s = summarizeGame(g.playersOrders, g.rounds);
    const idx = s.totals.findIndex((p) => p.id === linkedPlayer.id);
    if (idx === -1) continue;
    games += 1;
    if (s.isFinished) {
      finished += 1;
      total += s.totals[idx].score;
      if (idx === s.winnerIdx) wins += 1;
    }
  }
  const avg = finished ? (total / finished).toFixed(1) : "—";
  const initial =
    (linkedPlayer.name ?? "")
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  const unlink = async () => {
    await act("unclaimPlayer", { playerId: linkedPlayer.id });
  };

  const logout = () => sync.logOut();

  return (
    <>
      <AccountMovedBanner signedIn={!user.isGuest} />
      <div style={{ flex: 1, overflow: "auto", padding: "16px 16px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              background: t.goldFill,
              color: t.onGold,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: t.display,
              fontSize: 22,
              fontWeight: 700,
            }}
          >
            {initial}
          </div>
          <div>
            <div
              style={{
                fontFamily: t.display,
                fontSize: 20,
                color: t.cream,
                fontWeight: 600,
              }}
            >
              {linkedPlayer.name}
            </div>
            <div style={{ fontSize: 12, color: t.cream, opacity: 0.55 }}>
              {user.email ?? "Guest · this phone only"}
            </div>
          </div>
        </div>

        {user.isGuest && (
          <div
            style={{
              padding: 14,
              borderRadius: 12,
              border: `1px solid ${alpha(t.gold, 0.33)}`,
              marginBottom: 14,
              fontSize: 13,
              color: t.cream,
              lineHeight: 1.45,
            }}
          >
            This phone remembers you without an account.{" "}
            <Link
              to="/login?next=/user"
              style={{ color: t.gold, fontWeight: 600 }}
            >
              Add your email
            </Link>{" "}
            to keep your games on any phone.
          </div>
        )}

        <AlsoYou playerId={linkedPlayer.id} />

        <div
          style={{
            padding: 14,
            borderRadius: 12,
            background: alpha(t.shade, 0.25),
            border: `1px solid ${alpha(t.gold, 0.13)}`,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: t.gold,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              fontWeight: 700,
              marginBottom: 10,
            }}
          >
            Your stats
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 10,
            }}
          >
            <Stat label="Games" value={String(games)} />
            <Stat label="Wins" value={String(wins)} />
            <Stat label="Avg" value={avg} />
          </div>
        </div>

        <div
          style={{
            padding: 14,
            borderRadius: 12,
            background: alpha(t.shade, 0.25),
            border: `1px solid ${alpha(t.gold, 0.13)}`,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: t.gold,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              fontWeight: 700,
              marginBottom: 10,
            }}
          >
            Appearance
          </div>
          <ThemePicker />
        </div>

        {!user.isGuest && (
          <Row
            label="Change password"
            sub="Used to log in on other phones"
            onClick={() => setPasswordOpen(true)}
          />
        )}
        {passwordOpen && (
          <SetPasswordSheet onClose={() => setPasswordOpen(false)} />
        )}
        <Row
          label="Players & duplicates"
          sub="Find and merge players who are the same person"
          onClick={() => nav("/players")}
        />
        <Row
          label={user.isGuest ? `Not ${linkedPlayer.name}?` : "Unlink player"}
          sub={
            user.isGuest
              ? "Switch which player this phone is"
              : linkedPlayer.name
          }
          onClick={unlink}
        />
        <Row
          label="Sign out"
          sub={
            user.isGuest
              ? `This phone will forget it's ${linkedPlayer.name}`
              : undefined
          }
          onClick={logout}
          danger
        />
      </div>
    </>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div
      style={{
        fontFamily: t.mono,
        fontSize: 22,
        color: t.cream,
        fontWeight: 700,
      }}
    >
      {value}
    </div>
    <div
      style={{
        fontSize: 10,
        color: t.cream,
        opacity: 0.55,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        marginTop: 2,
      }}
    >
      {label}
    </div>
  </div>
);

const Row = ({
  label,
  sub,
  onClick,
  danger,
}: {
  label: string;
  sub?: string;
  onClick: () => void;
  danger?: boolean;
}) => (
  <div
    onClick={onClick}
    role="button"
    tabIndex={0}
    style={{
      padding: "14px",
      borderRadius: 10,
      marginBottom: 6,
      background: alpha(t.shade, 0.22),
      border: `1px solid ${alpha(t.gold, 0.13)}`,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      cursor: "pointer",
    }}
  >
    <div>
      <div
        style={{
          fontFamily: t.display,
          fontSize: 14,
          color: danger ? t.red : t.cream,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 11,
            color: t.cream,
            opacity: 0.55,
            marginTop: 2,
          }}
        >
          {sub}
        </div>
      )}
    </div>
    <div style={{ color: t.gold, opacity: 0.5, fontSize: 14 }}>›</div>
  </div>
);
