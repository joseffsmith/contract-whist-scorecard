import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  computeOpponents,
  computePlayerStats,
  PlayerStats as Stats,
  tallyRate,
  Tally,
} from "../stats/playerStats";
import {
  Bar,
  Card,
  Divider,
  fmtDate,
  mutedText,
  num,
  pct,
  plural,
  SectionLabel,
  SmallN,
  Tile,
  TileGrid,
} from "../stats/ui";
import { selectHomeGames, useSyncView } from "../sync";
import { alpha, goldButton, t } from "../theme/tokens";
import { Crumb } from "./chrome/Crumb";
import { Sheet } from "./chrome/Sheet";

const STYLE_WORD = {
  bold: "Bold",
  balanced: "Balanced",
  cautious: "Cautious",
} as const;

export const PlayerStats = () => {
  const { playerId = "" } = useParams<{ playerId: string }>();
  const nav = useNavigate();
  const { view, isLoading } = useSyncView();
  const [picking, setPicking] = useState(false);
  const games = selectHomeGames(view).games;
  const stats = useMemo(
    () => computePlayerStats(games, playerId),
    [games, playerId]
  );
  const opponents = useMemo(
    () => computeOpponents(games, playerId),
    [games, playerId]
  );
  const player = view.players.get(playerId);
  const back = () => nav("/leaderboard");

  if (player?.mergedInto) {
    return <Navigate to={`/stats/${player.mergedInto}`} replace />;
  }

  if (!player) {
    return (
      <>
        <Crumb
          trail={[{ label: "Board", to: "/leaderboard" }, { label: "Stats" }]}
          onBack={back}
        />
        <div style={{ padding: 20, opacity: 0.6 }}>
          {isLoading ? "Loading…" : "Player not found."}
        </div>
      </>
    );
  }

  return (
    <>
      <Crumb
        trail={[{ label: "Board", to: "/leaderboard" }, { label: player.name }]}
        onBack={back}
      />
      <div style={{ flex: 1, overflow: "auto", padding: "14px 16px 28px" }}>
        <div
          style={{
            fontFamily: t.display,
            fontSize: 28,
            fontWeight: 600,
            color: t.cream,
            lineHeight: 1.15,
            overflowWrap: "anywhere",
          }}
        >
          {player.name}
        </div>
        <div style={{ ...mutedText, fontSize: 12, marginTop: 4 }}>
          based on {plural(stats.rounds, "round")} ·{" "}
          {plural(stats.games, "game")}
        </div>

        {stats.rounds === 0 ? (
          <Card style={{ marginTop: 18 }}>
            <div
              style={{ fontFamily: t.display, fontSize: 17, color: t.cream }}
            >
              Nothing to show yet
            </div>
            <div style={{ ...mutedText, marginTop: 6 }}>
              {player.name} hasn't completed a round. Once a few hands are
              scored, bidding style, hit rate and results will show up here.
            </div>
          </Card>
        ) : (
          <>
            <BiddingCard s={stats} />
            <HitRates s={stats} />
            <Results s={stats} />
            <FormSection s={stats} />
          </>
        )}

        <button
          onClick={() => setPicking(true)}
          style={{
            ...goldButton,
            width: "100%",
            marginTop: 22,
            padding: 14,
            borderRadius: 12,
            fontSize: 15,
          }}
        >
          Head to head →
        </button>
      </div>

      {picking && (
        <Sheet onClose={() => setPicking(false)}>
          <div
            style={{
              fontFamily: t.display,
              fontSize: 20,
              color: t.cream,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            {player.name} vs…
          </div>
          {opponents.length === 0 ? (
            <div style={{ ...mutedText, padding: "8px 0 4px" }}>
              Nobody has finished a game with {player.name} yet.
            </div>
          ) : (
            <>
              <div style={{ ...mutedText, fontSize: 12, marginBottom: 10 }}>
                People who've finished games together.
              </div>
              <div
                style={{
                  maxHeight: "50vh",
                  overflow: "auto",
                  borderRadius: 10,
                  border: `1px solid ${alpha(t.gold, 0.13)}`,
                }}
              >
                {opponents.map((o) => (
                  <Link
                    key={o.playerId}
                    to={`/stats/${playerId}/vs/${o.playerId}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "12px 14px",
                      background: alpha(t.shade, 0.3),
                      borderBottom: `1px solid ${alpha(t.gold, 0.08)}`,
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontFamily: t.display,
                        fontSize: 15,
                        fontWeight: 600,
                        color: t.cream,
                      }}
                    >
                      {o.name}
                    </div>
                    <div
                      style={{ fontSize: 12, color: t.cream, opacity: 0.55 }}
                    >
                      {plural(o.games, "game")}
                    </div>
                    <div style={{ color: t.gold, opacity: 0.7 }}>›</div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </Sheet>
      )}
    </>
  );
};

// ── Bidding style ───────────────────────────────────────────────────────

const BiddingCard = ({ s }: { s: Stats }) => {
  const misses = s.misses.over + s.misses.under;
  const zeroShare = s.rounds ? s.zeroBids.count / s.rounds : null;
  const zeroMade = s.zeroBids.count ? s.zeroBids.made / s.zeroBids.count : null;
  return (
    <>
      <SectionLabel>Bidding style</SectionLabel>
      <Card>
        <div
          style={{
            fontFamily: t.display,
            fontSize: 34,
            fontWeight: 600,
            color: t.gold,
            lineHeight: 1.1,
          }}
        >
          {s.style ? STYLE_WORD[s.style] : "—"}
          <SmallN n={s.rounds} />
        </div>
        <div
          style={{ fontSize: 13, color: t.cream, opacity: 0.8, marginTop: 4 }}
        >
          bids {num(s.aggression, 2)}× their fair share
        </div>
        <Gauge value={s.aggression} />

        <Divider />
        <TileGrid>
          <Tile
            label="Bids made"
            value={pct(s.hitRate)}
            sub={`${s.made} of ${s.rounds}`}
            hint={s.rounds}
          />
          <Tile
            label="Zero bids"
            value={pct(zeroShare)}
            sub={
              s.zeroBids.count
                ? `of rounds, made ${pct(zeroMade)}`
                : "of rounds"
            }
            hint={s.rounds}
          />
        </TileGrid>

        <Divider />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 8,
            fontSize: 13,
            color: t.cream,
            marginBottom: 8,
          }}
        >
          <span>
            <Dot color={t.red} />
            too greedy <b>{s.misses.under}</b>
          </span>
          <span style={{ textAlign: "right" }}>
            too cautious <b>{s.misses.over}</b>
            <Dot color={t.gold} right />
          </span>
        </div>
        {misses > 0 ? (
          <div
            style={{
              display: "flex",
              height: 8,
              borderRadius: 4,
              overflow: "hidden",
              background: alpha(t.shade, 0.3),
            }}
          >
            <div
              style={{
                width: `${(s.misses.under / misses) * 100}%`,
                background: alpha(t.red, 0.8),
              }}
            />
            <div style={{ flex: 1, background: alpha(t.gold, 0.6) }} />
          </div>
        ) : (
          <div style={{ ...mutedText, fontSize: 12 }}>No misses yet.</div>
        )}
        <div
          style={{ fontSize: 11, color: t.cream, opacity: 0.5, marginTop: 6 }}
        >
          Greedy: fewer tricks than bid. Cautious: more.
          <SmallN n={misses} />
        </div>

        <Divider />
        <BidSpread s={s} />
      </Card>
    </>
  );
};

const Dot = ({ color, right }: { color: string; right?: boolean }) => (
  <span
    style={{
      display: "inline-block",
      width: 8,
      height: 8,
      borderRadius: 4,
      background: color,
      margin: right ? "0 0 0 6px" : "0 6px 0 0",
    }}
  />
);

// Where a bidder sits between cautious and bold, on a 0.5×–1.5× scale.
const Gauge = ({ value }: { value: number | null }) => {
  if (value === null) return null;
  const lo = 0.5;
  const hi = 1.5;
  const at = ((Math.min(hi, Math.max(lo, value)) - lo) / (hi - lo)) * 100;
  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          position: "relative",
          height: 6,
          borderRadius: 3,
          background: alpha(t.shade, 0.3),
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "40%",
            width: "20%",
            top: 0,
            bottom: 0,
            background: alpha(t.gold, 0.25),
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${at}%`,
            top: -3,
            width: 12,
            height: 12,
            marginLeft: -6,
            borderRadius: 6,
            background: t.goldFill,
            border: `2px solid ${t.feltDk}`,
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          color: t.cream,
          opacity: 0.5,
          marginTop: 5,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        <span>Cautious</span>
        <span>Bold</span>
      </div>
    </div>
  );
};

const BidSpread = ({ s }: { s: Stats }) => {
  const bids = Object.keys(s.bidCounts).map(Number);
  const maxBid = Math.max(...bids);
  const maxCount = Math.max(...Object.values(s.bidCounts));
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: t.cream,
          opacity: 0.55,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        What they bid
      </div>
      {Array.from({ length: maxBid + 1 }, (_, bid) => {
        const count = s.bidCounts[bid] ?? 0;
        const top = bid === s.mostCommonBid;
        return (
          <div
            key={bid}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              height: 20,
            }}
          >
            <div
              style={{
                width: 14,
                textAlign: "right",
                fontFamily: t.mono,
                fontSize: 12,
                color: top ? t.gold : t.cream,
                fontWeight: top ? 700 : 400,
                opacity: top ? 1 : 0.7,
              }}
            >
              {bid}
            </div>
            <div style={{ flex: 1 }}>
              <Bar
                value={count / maxCount}
                height={8}
                color={top ? t.goldFill : alpha(t.gold, 0.45)}
              />
            </div>
            <div
              style={{
                width: 44,
                fontFamily: t.mono,
                fontSize: 11,
                color: t.cream,
                opacity: top ? 0.9 : 0.55,
                textAlign: "right",
              }}
            >
              {count}
              {top && <span style={{ color: t.gold }}> ★</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ── Hit rate breakdown ──────────────────────────────────────────────────

const RateRow = ({ label, tally }: { label: string; tally: Tally }) => {
  const rate = tallyRate(tally);
  const small = tally.rounds < 10;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        minHeight: 30,
        opacity: small ? 0.8 : 1,
      }}
    >
      <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: t.cream }}>
        {label}
      </div>
      <div style={{ width: 56, flexShrink: 0 }}>
        <Bar value={rate ?? 0} color={alpha(t.gold, small ? 0.35 : 0.53)} />
      </div>
      <div
        style={{
          width: 38,
          flexShrink: 0,
          textAlign: "right",
          fontFamily: t.mono,
          fontSize: 13,
          color: t.cream,
        }}
      >
        {pct(rate)}
      </div>
      <div
        style={{
          width: 32,
          flexShrink: 0,
          textAlign: "right",
          fontSize: 10,
          color: t.cream,
          opacity: 0.5,
        }}
      >
        ({tally.rounds})
      </div>
    </div>
  );
};

const GroupTitle = ({ children }: { children: string }) => (
  <div
    style={{
      fontSize: 10,
      color: t.cream,
      opacity: 0.55,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      margin: "2px 0 2px",
    }}
  >
    {children}
  </div>
);

const HitRates = ({ s }: { s: Stats }) => (
  <>
    <SectionLabel>Hit rate</SectionLabel>
    <Card>
      <GroupTitle>Hand size</GroupTitle>
      <RateRow label="Small · 1–3 cards" tally={s.bySize.small} />
      <RateRow label="Medium · 4–5 cards" tally={s.bySize.medium} />
      <RateRow label="Large · 6–7 cards" tally={s.bySize.large} />
      <Divider />
      <GroupTitle>Dealing</GroupTitle>
      <RateRow label="As dealer" tally={s.asDealer} />
      <RateRow label="Not dealing" tally={s.notDealer} />
      <Divider />
      <GroupTitle>Trump</GroupTitle>
      <RateRow label="Trumps" tally={s.trumps} />
      <RateRow label="No trumps 🚫" tally={s.noTrump} />
    </Card>
  </>
);

// ── Results ─────────────────────────────────────────────────────────────

const Results = ({ s }: { s: Stats }) => (
  <>
    <SectionLabel>Results</SectionLabel>
    <Card>
      {s.finished === 0 ? (
        <div style={mutedText}>
          No finished games yet. Results appear once a game has all 13 rounds
          scored.
        </div>
      ) : (
        <>
          <TileGrid>
            <Tile
              label="Wins"
              value={s.wins}
              sub={`of ${s.finished} finished`}
              hint={s.finished}
            />
            <Tile
              label="Win rate"
              value={pct(s.winRate)}
              sub={
                s.winRatio === null
                  ? undefined
                  : `${num(s.winRatio)}× expected for table size`
              }
              hint={s.finished}
            />
            <Tile
              label="Average score"
              value={num(s.averageScore)}
              hint={s.finished}
            />
            <Tile
              label="Personal best"
              value={
                s.personalBest ? (
                  <Link
                    to={`/games/${s.personalBest.gameId}`}
                    style={{ color: t.gold }}
                  >
                    {s.personalBest.score}
                  </Link>
                ) : (
                  "—"
                )
              }
              sub={s.personalBest ? fmtDate(s.personalBest.date) : undefined}
            />
          </TileGrid>
          <Divider />
          <TileGrid>
            <Tile
              label="Comebacks"
              value={s.comebacks}
              sub="won from behind after 7 rounds"
            />
            <Tile
              label="Collapses"
              value={s.collapses}
              sub="led after 7 rounds, didn't win"
            />
          </TileGrid>
        </>
      )}
    </Card>
  </>
);

// ── Form and streaks ────────────────────────────────────────────────────

const FormSection = ({ s }: { s: Stats }) => (
  <>
    <SectionLabel>
      {s.form.length === 0
        ? "Streaks"
        : s.form.length === 1
        ? "Form · last game"
        : `Form · last ${s.form.length} games`}
    </SectionLabel>
    {s.form.length > 0 && (
      <div style={{ display: "flex", gap: 6 }}>
        {s.form.map((f) => (
          <Link
            key={f.gameId}
            to={`/games/${f.gameId}`}
            style={{
              flex: "1 1 0",
              minWidth: 0,
              maxWidth: 88,
              padding: "9px 2px 8px",
              borderRadius: 12,
              textAlign: "center",
              background: f.won ? t.goldFill : alpha(t.shade, 0.22),
              border: f.won
                ? "1px solid transparent"
                : `1px solid ${alpha(t.gold, 0.13)}`,
              color: f.won ? t.onGold : t.cream,
            }}
          >
            <div
              style={{
                fontFamily: t.display,
                fontSize: 15,
                fontWeight: 700,
                color: f.won ? t.onGold : t.gold,
              }}
            >
              {f.position}/{f.numPlayers}
            </div>
            <div style={{ fontFamily: t.mono, fontSize: 12, marginTop: 2 }}>
              {f.score}
            </div>
            <div
              style={{ fontSize: 9, opacity: f.won ? 0.75 : 0.5, marginTop: 2 }}
            >
              {fmtDate(f.date)}
            </div>
          </Link>
        ))}
      </div>
    )}
    <Card style={{ marginTop: s.form.length > 0 ? 8 : 0 }}>
      <TileGrid>
        <Tile
          label="Current streak"
          value={s.currentMadeStreak}
          sub="bids made in a row"
        />
        <Tile
          label="Longest streak"
          value={s.longestMadeStreak}
          sub="bids made in a row"
        />
      </TileGrid>
    </Card>
  </>
);
