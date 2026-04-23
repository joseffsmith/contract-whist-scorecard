import { Link, useNavigate } from "react-router-dom";
import { DEALS } from "../constants";
import { db } from "../db";
import { queryHomeGames } from "../queries";
import { goldButton, suitColor, t } from "../theme/tokens";
import { summarizeGame } from "../utils/gameStatus";

export const Home = () => {
  const nav = useNavigate();
  const { user } = db.useAuth();
  const { data, isLoading } = db.useQuery(queryHomeGames);

  if (isLoading) {
    return <CenterMsg text="Loading…" />;
  }

  const games = (data?.games ?? [])
    .filter((g) => !g.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Active game: most recent unfinished game the user created.
  const myActive = games.find((g) => {
    if (g.createdBy !== user?.id) return false;
    const { isFinished } = summarizeGame(g.playersOrders, g.rounds);
    return !isFinished;
  });
  const past = games.filter((g) => g !== myActive).slice(0, 5);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "14px 16px 16px" }}>
      {myActive ? (
        <ContinueCard gameId={myActive.id} game={myActive} />
      ) : (
        <EmptyActive />
      )}

      <div
        style={{
          marginTop: 22,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: t.gold,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          Recent games
        </div>
        <Link
          to="/games"
          style={{ fontSize: 11, color: t.gold, opacity: 0.8 }}
        >
          See all →
        </Link>
      </div>

      {past.length === 0 && (
        <div
          style={{
            fontSize: 12,
            color: t.cream,
            opacity: 0.5,
            padding: "12px 0",
          }}
        >
          No games yet.
        </div>
      )}

      {past.map((g) => {
        const { totals, winnerIdx, isFinished } = summarizeGame(
          g.playersOrders,
          g.rounds
        );
        const winner = isFinished && winnerIdx >= 0 ? totals[winnerIdx] : null;
        const date = new Date(g.createdAt);
        return (
          <div
            key={g.id}
            onClick={() => nav(`/games/${g.id}`)}
            style={{
              padding: "10px 12px",
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
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: t.display,
                  fontSize: 14,
                  color: t.cream,
                  fontWeight: 600,
                }}
              >
                {winner ? (
                  <>
                    {winner.name}{" "}
                    <span
                      style={{
                        color: t.gold,
                        opacity: 0.7,
                        fontWeight: 400,
                        fontSize: 12,
                      }}
                    >
                      won
                    </span>
                  </>
                ) : (
                  <span style={{ opacity: 0.7, fontWeight: 500 }}>
                    In progress
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: t.cream,
                  opacity: 0.5,
                  marginTop: 2,
                }}
              >
                {date.toLocaleString()}
              </div>
            </div>
            <div style={{ fontFamily: t.mono, fontSize: 13, color: t.gold }}>
              {winner ? winner.score : "…"}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const CenterMsg = ({ text }: { text: string }) => (
  <div style={{ padding: 20, opacity: 0.6, fontSize: 13 }}>{text}</div>
);

const EmptyActive = () => (
  <div
    style={{
      padding: "20px 16px",
      borderRadius: 14,
      border: `1px dashed ${t.gold}55`,
      color: t.gold,
      textAlign: "center",
      fontFamily: t.display,
      fontSize: 14,
    }}
  >
    No game in progress — tap <b>+ Deal</b> to start one.
  </div>
);

const ContinueCard = ({
  gameId,
  game,
}: {
  gameId: string;
  game: {
    playersOrders: any[];
    rounds: any[];
  };
}) => {
  const nav = useNavigate();
  const summary = summarizeGame(game.playersOrders, game.rounds);
  const deal = DEALS[summary.currentRoundIdx];
  const leader = summary.totals[summary.leaderIdx];
  const sColor = suitColor(deal?.suit ?? "");

  return (
    <div
      onClick={() => nav(`/games/${gameId}`)}
      style={{
        padding: "16px 16px 14px",
        borderRadius: 16,
        background: `linear-gradient(180deg, ${t.panel}, ${t.panelDk})`,
        color: t.ink,
        boxShadow:
          "0 14px 36px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.55)",
        border: `1px solid ${t.gold}77`,
        position: "relative",
        overflow: "hidden",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          position: "absolute",
          right: -24,
          top: -20,
          fontSize: 140,
          color: `${sColor}22`,
          lineHeight: 1,
        }}
      >
        {deal?.suit}
      </div>
      <div
        style={{
          fontSize: 10,
          color: t.goldDk,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          fontWeight: 700,
        }}
      >
        Continue
      </div>
      <div
        style={{
          fontFamily: t.display,
          fontSize: 22,
          fontWeight: 600,
          color: t.ink,
          marginTop: 2,
          lineHeight: 1.1,
        }}
      >
        Round {summary.currentRoundIdx + 1} · {deal?.num_cards}
        <span style={{ color: sColor, marginLeft: 4 }}>{deal?.suit}</span>
      </div>
      {leader && (
        <div style={{ fontSize: 12, color: t.ink2, marginTop: 4 }}>
          {leader.name} leading {leader.score}
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${summary.totals.length || 1}, 1fr)`,
          gap: 6,
          marginTop: 12,
          paddingTop: 12,
          borderTop: `1px solid ${t.goldDk}33`,
        }}
      >
        {summary.totals.map((p, i) => (
          <div key={p.id} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, color: t.ink2 }}>{p.name}</div>
            <div
              style={{
                fontFamily: t.mono,
                fontSize: 17,
                fontWeight: 700,
                color: i === summary.leaderIdx ? t.red : t.ink,
                marginTop: 2,
              }}
            >
              {p.score}
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          ...goldButton,
          marginTop: 14,
          padding: "10px 12px",
          borderRadius: 10,
          textAlign: "center",
          fontSize: 14,
        }}
      >
        Resume game →
      </div>
    </div>
  );
};
