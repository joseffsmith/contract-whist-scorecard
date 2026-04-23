import { useNavigate } from "react-router-dom";
import { db } from "../db";
import { queryHomeGames, queryPlayersWithUserId } from "../queries";
import { t } from "../theme/tokens";
import { summarizeGame } from "../utils/gameStatus";
import { LinkPlayerToMe } from "./UserLogin";

export const UserManager = () => {
  const nav = useNavigate();
  const { isLoading: isLoadingUser, user } = db.useAuth();

  const { data: playerData, isLoading: isLoadingPlayer } = db.useQuery(
    user ? queryPlayersWithUserId(user.id) : null
  );
  const { data: gamesData } = db.useQuery(queryHomeGames);

  if (isLoadingUser) {
    return <div style={{ padding: 20, opacity: 0.6 }}>Loading…</div>;
  }
  if (!user) {
    nav("/login");
    return null;
  }
  if (isLoadingPlayer) {
    return <div style={{ padding: 20, opacity: 0.6 }}>Loading…</div>;
  }

  const linkedPlayer = playerData?.players[0];

  if (!linkedPlayer) {
    return <LinkPlayerToMe />;
  }

  // Stats for this player
  let games = 0,
    finished = 0,
    wins = 0,
    total = 0;
  for (const g of gamesData?.games ?? []) {
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
    await db.transact([
      db.tx.players[linkedPlayer.id].unlink({ $user: user.id }),
    ]);
  };

  const logout = () => db.auth.signOut();

  return (
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
            background: t.gold,
            color: t.feltDk,
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
            {user.email}
          </div>
        </div>
      </div>

      <div
        style={{
          padding: 14,
          borderRadius: 12,
          background: "rgba(0,0,0,0.25)",
          border: `1px solid ${t.gold}22`,
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

      <Row label="Unlink player" sub={linkedPlayer.name} onClick={unlink} />
      <Row label="Sign out" onClick={logout} danger />
    </div>
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
      background: "rgba(0,0,0,0.22)",
      border: `1px solid ${t.gold}22`,
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
