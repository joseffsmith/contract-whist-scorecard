import { ReactNode, useMemo } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { computeHeadToHead } from "../stats/playerStats";
import {
  Bar,
  Card,
  fmtDate,
  mutedText,
  num,
  pct,
  SectionLabel,
  SmallN,
} from "../stats/ui";
import { selectHomeGames, useSyncView } from "../sync";
import { alpha, t } from "../theme/tokens";
import { Crumb } from "./chrome/Crumb";

// Colours that tell the two players apart in both themes.
const colorA = t.goldFill;
const colorB = alpha(t.cream, 0.55);

export const HeadToHead = () => {
  const { playerId = "", otherId = "" } = useParams<{
    playerId: string;
    otherId: string;
  }>();
  const nav = useNavigate();
  const { view, isLoading } = useSyncView();
  const games = selectHomeGames(view).games;
  const h = useMemo(
    () => computeHeadToHead(games, playerId, otherId),
    [games, playerId, otherId]
  );
  const a = view.players.get(playerId);
  const b = view.players.get(otherId);
  const back = () => nav(`/stats/${playerId}`);

  // A merged-away player's rows live on their target now.
  if (a?.mergedInto || b?.mergedInto) {
    return (
      <Navigate
        to={`/stats/${a?.mergedInto ?? playerId}/vs/${
          b?.mergedInto ?? otherId
        }`}
        replace
      />
    );
  }

  if (!a || !b || playerId === otherId) {
    return (
      <>
        <Crumb
          trail={[
            { label: "Board", to: "/leaderboard" },
            { label: "Head to head" },
          ]}
          onBack={() => nav("/leaderboard")}
        />
        <div style={{ padding: 20, opacity: 0.6 }}>
          {isLoading ? "Loading…" : "Players not found."}
        </div>
      </>
    );
  }

  const margin = h.avgMargin;
  const marginText =
    margin === null
      ? null
      : Math.abs(margin) < 0.05
      ? `${a.name} and ${b.name} score the same on average`
      : `${a.name} scores ${Math.abs(margin).toFixed(1)} ${
          margin > 0 ? "more" : "fewer"
        } on average`;

  return (
    <>
      <Crumb
        trail={[
          { label: "Board", to: "/leaderboard" },
          { label: a.name, to: `/stats/${playerId}` },
          { label: `vs ${b.name}` },
        ]}
        onBack={back}
      />
      <div style={{ flex: 1, overflow: "auto", padding: "14px 16px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Name color={colorA}>{a.name}</Name>
          <button
            aria-label="Swap players"
            title="Swap players"
            onClick={() =>
              nav(`/stats/${otherId}/vs/${playerId}`, { replace: true })
            }
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              flexShrink: 0,
              border: `1px solid ${alpha(t.gold, 0.33)}`,
              color: t.gold,
              background: "transparent",
              fontSize: 16,
              padding: 0,
              lineHeight: 1,
            }}
          >
            ⇄
          </button>
          <Name color={colorB} right>
            {b.name}
          </Name>
        </div>

        {h.games === 0 && h.sharedRounds === 0 ? (
          <Card style={{ marginTop: 18 }}>
            <div
              style={{ fontFamily: t.display, fontSize: 17, color: t.cream }}
            >
              Never played together
            </div>
            <div style={{ ...mutedText, marginTop: 6 }}>
              {a.name} and {b.name} haven't shared a game yet. Once they have,
              the scoreboard between them shows up here.
            </div>
          </Card>
        ) : (
          <>
            <SectionLabel>Finished higher</SectionLabel>
            <Card>
              {h.games === 0 ? (
                <div style={mutedText}>
                  No finished games together yet, so there's no scoreline.
                </div>
              ) : (
                <>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "center",
                      gap: 14,
                      fontFamily: t.display,
                      fontWeight: 600,
                      color: t.cream,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 52,
                        lineHeight: 1,
                        color: h.aAhead > h.bAhead ? t.gold : t.cream,
                      }}
                    >
                      {h.aAhead}
                    </span>
                    <span style={{ fontSize: 28, opacity: 0.5 }}>–</span>
                    <span
                      style={{
                        fontSize: 52,
                        lineHeight: 1,
                        color: h.bAhead > h.aAhead ? t.gold : t.cream,
                      }}
                    >
                      {h.bAhead}
                    </span>
                  </div>
                  <div
                    style={{
                      textAlign: "center",
                      fontSize: 12,
                      color: t.cream,
                      opacity: 0.6,
                      marginTop: 6,
                    }}
                  >
                    {h.draws > 0
                      ? `${h.draws} draw${h.draws === 1 ? "" : "s"} · `
                      : ""}
                    {h.games} finished game{h.games === 1 ? "" : "s"}
                    <SmallN n={h.games} />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      height: 8,
                      borderRadius: 4,
                      overflow: "hidden",
                      marginTop: 12,
                      background: alpha(t.shade, 0.3),
                    }}
                  >
                    <div style={{ flex: h.aAhead, background: colorA }} />
                    <div
                      style={{
                        flex: h.draws,
                        background: alpha(t.shade, 0.35),
                      }}
                    />
                    <div style={{ flex: h.bAhead, background: colorB }} />
                  </div>
                  {marginText && (
                    <div
                      style={{
                        textAlign: "center",
                        fontSize: 13,
                        color: t.cream,
                        opacity: 0.85,
                        marginTop: 12,
                      }}
                    >
                      {marginText}
                    </div>
                  )}
                </>
              )}
            </Card>

            {h.games > 0 && (
              <>
                <SectionLabel>Biggest wins</SectionLabel>
                <div style={{ display: "flex", gap: 8 }}>
                  <BigWin name={a.name} color={colorA} win={h.biggestWinA} />
                  <BigWin name={b.name} color={colorB} win={h.biggestWinB} />
                </div>
              </>
            )}

            <SectionLabel>Hit rate together</SectionLabel>
            <Card>
              {h.sharedRounds === 0 ? (
                <div style={mutedText}>No rounds scored together yet.</div>
              ) : (
                <>
                  <HitRow name={a.name} rate={h.aHitRate} color={colorA} />
                  <div style={{ height: 8 }} />
                  <HitRow name={b.name} rate={h.bHitRate} color={colorB} />
                  <div
                    style={{
                      fontSize: 11,
                      color: t.cream,
                      opacity: 0.5,
                      marginTop: 10,
                    }}
                  >
                    Bids made over {h.sharedRounds} rounds they both played
                    <SmallN n={h.sharedRounds} />
                  </div>
                </>
              )}
            </Card>

            {h.recent.length > 0 && (
              <>
                <SectionLabel>Recent games together</SectionLabel>
                {h.recent.map((r) => (
                  <Link
                    key={r.gameId}
                    to={`/games/${r.gameId}`}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 12,
                      marginBottom: 6,
                      background: alpha(t.shade, 0.22),
                      border: `1px solid ${alpha(t.gold, 0.13)}`,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: t.cream }}>
                        {fmtDate(r.date)}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: t.cream,
                          opacity: 0.55,
                          marginTop: 1,
                        }}
                      >
                        {r.numPlayers} players
                      </div>
                    </div>
                    <Score
                      who={a.name}
                      score={r.aScore}
                      won={r.aScore > r.bScore}
                    />
                    <span style={{ opacity: 0.4 }}>–</span>
                    <Score
                      who={b.name}
                      score={r.bScore}
                      won={r.bScore > r.aScore}
                    />
                  </Link>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
};

const Name = ({
  children,
  color,
  right,
}: {
  children: ReactNode;
  color: string;
  right?: boolean;
}) => (
  <div
    style={{
      flex: 1,
      minWidth: 0,
      display: "flex",
      alignItems: "center",
      gap: 8,
      justifyContent: right ? "flex-end" : "flex-start",
      flexDirection: right ? "row-reverse" : "row",
    }}
  >
    <span
      style={{
        width: 9,
        height: 9,
        borderRadius: 5,
        background: color,
        flexShrink: 0,
      }}
    />
    <span
      style={{
        fontFamily: t.display,
        fontSize: 20,
        fontWeight: 600,
        color: t.cream,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  </div>
);

const BigWin = ({
  name,
  color,
  win,
}: {
  name: string;
  color: string;
  win: { margin: number; gameId: string; date: string } | null;
}) => {
  const body = (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: t.cream,
          opacity: 0.6,
          minWidth: 0,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            background: color,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
      </div>
      <div
        style={{
          fontFamily: t.display,
          fontSize: 26,
          fontWeight: 600,
          color: win ? t.gold : t.cream,
          marginTop: 4,
          opacity: win ? 1 : 0.5,
        }}
      >
        {win ? `+${win.margin}` : "—"}
      </div>
      <div style={{ fontSize: 11, color: t.cream, opacity: 0.5, marginTop: 2 }}>
        {win ? fmtDate(win.date) : "no wins yet"}
      </div>
    </>
  );
  const style = {
    flex: 1,
    minWidth: 0,
    padding: "12px 14px",
    borderRadius: 12,
    background: alpha(t.shade, 0.22),
    border: `1px solid ${alpha(t.gold, 0.13)}`,
  };
  return win ? (
    <Link to={`/games/${win.gameId}`} style={style}>
      {body}
    </Link>
  ) : (
    <div style={style}>{body}</div>
  );
};

const HitRow = ({
  name,
  rate,
  color,
}: {
  name: string;
  rate: number | null;
  color: string;
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <div
      style={{
        width: 84,
        flexShrink: 0,
        fontSize: 13,
        color: t.cream,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {name}
    </div>
    <div style={{ flex: 1 }}>
      <Bar value={rate ?? 0} color={color} height={8} />
    </div>
    <div
      style={{
        width: 40,
        textAlign: "right",
        fontFamily: t.mono,
        fontSize: 13,
        color: t.cream,
      }}
    >
      {pct(rate)}
    </div>
  </div>
);

const Score = ({
  who,
  score,
  won,
}: {
  who: string;
  score: number;
  won: boolean;
}) => (
  <div style={{ textAlign: "center", minWidth: 0, maxWidth: 72 }}>
    <div
      style={{
        fontFamily: t.mono,
        fontSize: 15,
        color: won ? t.gold : t.cream,
        fontWeight: won ? 700 : 400,
        opacity: won ? 1 : 0.75,
      }}
    >
      {num(score, 0)}
    </div>
    <div
      style={{
        fontSize: 10,
        color: t.cream,
        opacity: 0.5,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {who}
    </div>
  </div>
);
