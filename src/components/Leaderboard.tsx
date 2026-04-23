import { db } from "../db";
import { queryHomeGames } from "../queries";
import { t } from "../theme/tokens";
import { summarizeGame } from "../utils/gameStatus";

type Row = {
  id: string;
  name: string;
  games: number;
  finished: number;
  wins: number;
  totalScore: number;
};

export const Leaderboard = () => {
  const { data, isLoading } = db.useQuery(queryHomeGames);

  if (isLoading) {
    return <div style={{ padding: 20, opacity: 0.6 }}>Loading…</div>;
  }

  const byPlayer = new Map<string, Row>();
  for (const g of data?.games ?? []) {
    if (g.deletedAt) continue;
    const s = summarizeGame(g.playersOrders, g.rounds);
    for (let i = 0; i < s.totals.length; i++) {
      const p = s.totals[i];
      const row = byPlayer.get(p.id) ?? {
        id: p.id,
        name: p.name,
        games: 0,
        finished: 0,
        wins: 0,
        totalScore: 0,
      };
      row.games += 1;
      if (s.isFinished) {
        row.finished += 1;
        row.totalScore += p.score;
        if (i === s.winnerIdx) row.wins += 1;
      }
      byPlayer.set(p.id, row);
    }
  }
  const rows = [...byPlayer.values()]
    .filter((r) => r.games > 0)
    .sort((a, b) => b.wins - a.wins || b.finished - a.finished);
  const max = Math.max(1, ...rows.map((r) => r.wins));

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "14px 16px 16px" }}>
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
        All time · by wins
      </div>

      {rows.length === 0 && (
        <div style={{ opacity: 0.6, fontSize: 13 }}>No finished games yet.</div>
      )}

      {rows.map((r, i) => {
        const avg = r.finished ? (r.totalScore / r.finished).toFixed(1) : "—";
        return (
          <div
            key={r.id}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              marginBottom: 6,
              background: i === 0 ? `${t.gold}15` : "rgba(0,0,0,0.22)",
              border: `1px solid ${i === 0 ? t.gold + "55" : t.gold + "22"}`,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                background: i === 0 ? t.gold : "transparent",
                border: i === 0 ? "none" : `1px solid ${t.gold}44`,
                color: i === 0 ? t.feltDk : t.gold,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: t.display,
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {i + 1}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: t.display,
                  fontSize: 15,
                  color: t.cream,
                  fontWeight: 600,
                }}
              >
                {r.name}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: t.cream,
                  opacity: 0.55,
                  marginTop: 1,
                }}
              >
                {r.wins} wins · {r.finished}/{r.games} games · avg {avg}
              </div>
            </div>
            <div
              style={{
                width: 80,
                height: 6,
                borderRadius: 3,
                background: "rgba(0,0,0,0.3)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${(r.wins / max) * 100}%`,
                  height: "100%",
                  background: i === 0 ? t.gold : t.gold + "88",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
