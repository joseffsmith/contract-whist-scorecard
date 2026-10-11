import { Fragment, useEffect, useState } from "react";
import Confetti from "react-confetti";
import { useNavigate, useParams } from "react-router-dom";
import { DEALS } from "../constants";
import { act, newId } from "../lib/dispatch";
import { useGame } from "../lib/offline";
import { useAuth, useConnectionStatus } from "../sync";
import {
  alpha,
  fluid,
  goldButton,
  perColumn,
  suitColor,
  t,
} from "../theme/tokens";
import { MoreMenu } from "./chrome/MoreMenu";
import { InviteSheet } from "./InviteSheet";
import { ThemeToggle } from "./chrome/ThemeToggle";
import { autoFillTricks } from "../utils/autoFillTricks";
import { getBidOptions } from "../utils/getBidOptions";
import { getCurrentPlayerIdFromRound } from "../utils/getCurrentPlayerIdFromRound";
import { getDealerIdx } from "../utils/getDealerIdx";
import { Crumb } from "./chrome/Crumb";

// Width of the round label column in the scorecard grid.
const ROUND_COL = "clamp(40px, 11vw, 52px)";

export const GameComp = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const [isConfettiClosed, setIsClosed] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const { isLoading: isLoadingUser, user } = useAuth();
  const { isLoading, game } = useGame(gameId);
  const connecting = useConnectionStatus() === "connecting";

  useEffect(() => {
    if (!gameId) navigate("/");
  }, [gameId, navigate]);

  if (!game || isLoadingUser || isLoading) {
    return (
      <>
        <Crumb trail={[{ label: "Home", to: "/" }, { label: "Game" }]} />
        <div style={{ padding: 20, opacity: 0.6 }}>
          {isLoading || isLoadingUser || connecting
            ? "Loading…"
            : "Game not found."}
        </div>
      </>
    );
  }
  const initialDealerId = game.initialDealerId;
  // The dealer's position among the seated players (not its orderNumber,
  // which can have gaps after a removal).
  const seated = [...game.playersOrders]
    .sort((a, b) => a.orderNumber - b.orderNumber)
    .filter((po) => po.player);
  const dealerSeat = seated.findIndex(
    (po) => po.player!.id === initialDealerId
  );
  const initialDealerIdx = dealerSeat === -1 ? null : dealerSeat;

  const rs = game.rounds.sort((a, b) => a.roundNumber - b.roundNumber);
  // Skip a seat whose player hasn't loaded rather than crashing.
  const numPlayers = game.playersOrders.filter((po) => po.player).length;

  const isGameFinished = rs.every(
    (r) =>
      r.turns.length === numPlayers &&
      r.turns.every((x) => x.score !== undefined && x.score !== null)
  );

  const lastRound = isGameFinished
    ? rs[rs.length - 1]
    : rs.find(
        (r) =>
          r.turns.length !== numPlayers ||
          r.turns.some((x) => x.score === undefined || x.score === null)
      ) ?? rs[0];
  const currentRoundIdx = lastRound.roundNumber;
  const currentRound = rs.length ? rs[currentRoundIdx] ?? null : null;
  const dealerIdx = getDealerIdx(currentRoundIdx, numPlayers, initialDealerIdx);

  const players = Object.values(game.playersOrders)
    .sort((a, b) => a.orderNumber - b.orderNumber)
    .flatMap((p) => (p.player ? [p.player] : []));

  const currentPlayerId = getCurrentPlayerIdFromRound(
    currentRound,
    dealerIdx,
    players
  );

  const numTurns = currentRound ? currentRound.turns.length : 0;
  const stage: "bid" | "score" = numTurns === players.length ? "score" : "bid";

  const getScoreForPlayer = (playerId: string) =>
    rs.reduce((prev, r) => {
      const turn = r.turns.find((tt) => tt.player?.id === playerId);
      return prev + (turn?.score ?? 0);
    }, 0);

  const scores = players.map((p) => getScoreForPlayer(p!.id));
  const leadScore = Math.max(...scores, 0);
  const winningScorerIdx = scores.findIndex((s) => s === leadScore);
  // The host (or the app admin) runs the game.
  const isOwnGame = user?.id === game.createdBy || !!user?.isAdmin;

  const handleBid = async (opt: { number: number; disabled: boolean }) => {
    if (!opt.disabled && currentPlayerId !== null) {
      await act("placeBid", {
        turnId: newId(),
        roundId: currentRound!.id,
        playerId: currentPlayerId,
        bid: opt.number,
      });
    }
  };

  const setTricksMade = async (tricks: number) => {
    if (currentPlayerId !== null) {
      const turn = currentRound?.turns.find(
        (tt) => tt.player?.id === currentPlayerId
      );
      const score = turn?.bid === tricks ? tricks + 10 : tricks;
      if (!(await act("setScore", { turnId: turn!.id, score }))) return;
      // The tricks entered so far may settle the rest of the round (all cards
      // accounted for, or one player left): fill those in, in seat order
      // after this player.
      const idx = players.findIndex((p) => p.id === currentPlayerId);
      const fromNext = [...players.slice(idx + 1), ...players.slice(0, idx)];
      const turns = fromNext.flatMap((p) => {
        const t = currentRound!.turns.find((tt) => tt.player?.id === p.id);
        return t ? [t] : [];
      });
      const fills =
        turns.length === players.length - 1
          ? autoFillTricks(
              [...turns, { ...turn!, score }],
              DEALS[currentRoundIdx].num_cards
            )
          : [];
      for (const fill of fills) {
        if (!(await act("setScore", fill))) return;
      }
    }
  };

  const undo = async () => {
    let round_to_undo = currentRound;
    let round_idx = currentRoundIdx;
    if (
      !round_to_undo ||
      round_to_undo.turns.every(
        (tt) =>
          (tt.bid === undefined || tt.bid === null) &&
          (tt.score === undefined || tt.score === null)
      )
    ) {
      round_idx -= 1;
      round_to_undo = rs[round_idx] ?? null;
    }
    if (!round_to_undo) return;

    const d = getDealerIdx(round_idx, players.length, initialDealerIdx);
    let player = getCurrentPlayerIdFromRound(round_to_undo, d, players);
    if (!player) player = players[(d + 1) % players.length]?.id ?? null;

    let player_idx = players.findIndex((p) => p?.id === player);
    player_idx -= 1;
    if (player_idx < 0) player_idx = players.length - 1;
    const playerToUndo = players[player_idx];

    const turnToUndo = round_to_undo.turns.find(
      (p) => p.player?.id === playerToUndo?.id
    );
    if (turnToUndo?.score !== undefined && turnToUndo.score !== null) {
      await act("clearScore", { turnId: turnToUndo.id });
      return;
    }
    if (turnToUndo) await act("deleteTurn", { turnId: turnToUndo.id });
  };

  const bidOptions = getBidOptions(
    currentRound,
    currentRoundIdx,
    players,
    stage
  );

  // ─── Win screen takeover ───
  if (isGameFinished && !isConfettiClosed) {
    return (
      <WinScreen
        players={players.map((p, i) => ({
          id: p!.id,
          name: p!.name,
          score: scores[i],
          isWinner: i === winningScorerIdx,
        }))}
        onClose={() => setIsClosed(true)}
        onUndo={isOwnGame ? undo : undefined}
        numRounds={rs.length}
      />
    );
  }

  // Text scales with each player column's width: bigger on wide phones and
  // with fewer players, never smaller than before.
  const chipGutters = 32 + 6 * (players.length - 1);
  const chipName = perColumn(players.length, chipGutters, 7, 10, 13);
  const chipScore = perColumn(players.length, chipGutters, 4, 16, 22);
  const cellFont = perColumn(players.length, 32 + 52, 4.4, 12, 17);

  const currentDeal = DEALS[currentRoundIdx];
  const sColor = suitColor(currentDeal?.suit ?? "");
  const currentPlayer = players.find((p) => p?.id === currentPlayerId);
  const dealer = players[dealerIdx];
  const bidsIn = currentRound?.turns.length ?? 0;

  return (
    <>
      <Crumb
        trail={[
          { label: "Home", to: "/" },
          {
            label: (
              <span>
                Round {currentRoundIdx + 1} ·{" "}
                <span style={{ fontFamily: t.mono, fontSize: 14 }}>
                  {currentDeal.num_cards}
                </span>
                <span style={{ color: sColor }}>{currentDeal.suit}</span>
              </span>
            ),
          },
        ]}
        right={
          <div style={{ display: "flex", gap: 6 }}>
            {isOwnGame && (
              <button
                onClick={undo}
                style={{
                  fontSize: 10,
                  color: t.gold,
                  border: `1px solid ${alpha(t.gold, 0.33)}`,
                  padding: "4px 8px",
                  borderRadius: 14,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  background: "transparent",
                }}
              >
                Undo
              </button>
            )}
            <ThemeToggle size={26} />
            {isOwnGame && (
              <MoreMenu
                items={[
                  {
                    label: "Invite by QR code",
                    onClick: () => setInviteOpen(true),
                  },
                  {
                    label: "Manage players",
                    onClick: () => navigate(`/games/${gameId}/manage`),
                  },
                ]}
              />
            )}
          </div>
        }
      />

      {inviteOpen && (
        <InviteSheet gameId={gameId!} onClose={() => setInviteOpen(false)} />
      )}

      {/* Hero */}
      <div
        style={{
          margin: "12px 16px 0",
          padding: "14px 16px",
          borderRadius: 12,
          background: `linear-gradient(180deg, ${t.panel}, ${t.panelDk})`,
          color: t.ink,
          boxShadow: `0 10px 30px ${alpha(
            t.shade,
            0.35
          )}, inset 0 1px 0 rgba(255,255,255,0.5)`,
          position: "relative",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -20,
            top: -20,
            fontSize: 130,
            color: alpha(sColor === t.cream ? t.ink : sColor, 0.13),
            lineHeight: 1,
            fontWeight: 700,
          }}
        >
          {currentDeal.suit}
        </div>
        <div
          style={{
            fontSize: fluid(10, 2.7, 12),
            color: t.goldDk,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          To {stage}
        </div>
        <div
          style={{
            fontFamily: t.display,
            fontSize: fluid(28, 7.6, 34),
            fontWeight: 600,
            color: t.ink,
            marginTop: 2,
            lineHeight: 1,
          }}
        >
          {currentPlayer?.name ?? "—"}
        </div>
        <div
          style={{ fontSize: fluid(12, 3.2, 14), color: t.ink2, marginTop: 4 }}
        >
          {dealer ? `${dealer.name} dealt` : ""} ·{" "}
          {stage === "bid"
            ? `${bidsIn} of ${players.length} bid`
            : `${
                currentRound?.turns.filter(
                  (tt) => tt.score !== null && tt.score !== undefined
                ).length ?? 0
              } of ${players.length} scored`}
        </div>
      </div>

      {/* Player chips */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${players.length}, 1fr)`,
          gap: 6,
          padding: "10px 16px 0",
          flexShrink: 0,
        }}
      >
        {players.map((p, i) => {
          const isLead = scores[i] === leadScore && leadScore > 0;
          const isTurn = p!.id === currentPlayerId;
          return (
            <div
              key={p!.id}
              style={{
                padding: "6px 4px",
                borderRadius: 8,
                textAlign: "center",
                background: isTurn ? alpha(t.gold, 0.13) : "transparent",
                border: `1px solid ${isTurn ? t.gold : alpha(t.gold, 0.13)}`,
              }}
            >
              <div
                style={{
                  fontSize: chipName,
                  color: t.cream,
                  opacity: 0.8,
                }}
              >
                {p!.name}
              </div>
              <div
                style={{
                  fontFamily: t.mono,
                  fontSize: chipScore,
                  fontWeight: 600,
                  marginTop: 1,
                  color: isLead ? t.gold : t.cream,
                }}
              >
                {scores[i]}
              </div>
            </div>
          );
        })}
      </div>

      {/* Rounds grid */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "10px 16px 10px",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Rows stretch to fill the free height on tall phones. */}
        <div
          style={{
            borderRadius: 10,
            overflow: "hidden",
            border: `1px solid ${alpha(t.gold, 0.13)}`,
            flex: "1 0 auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {DEALS.map((deal, rIdx) => {
            const isCurrent = rIdx === currentRoundIdx;
            const isPast = rIdx < currentRoundIdx;
            const turns = rs[rIdx]?.turns ?? [];
            const sc = suitColor(deal.suit);
            return (
              <Fragment key={rIdx}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `${ROUND_COL} repeat(${players.length}, minmax(0, 1fr))`,
                    borderBottom:
                      rIdx < DEALS.length - 1
                        ? `1px solid ${alpha(t.gold, 0.08)}`
                        : "none",
                    background: isCurrent ? alpha(t.gold, 0.08) : "transparent",
                    minHeight: 32,
                    flex: "1 0 auto",
                  }}
                >
                  <div
                    style={{
                      padding: "5px 6px",
                      fontFamily: t.mono,
                      fontSize: fluid(12, 3.4, 15),
                      color: isCurrent ? t.gold : t.cream,
                      opacity: isPast ? 0.5 : 1,
                      borderRight: `1px solid ${alpha(t.gold, 0.08)}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 2,
                    }}
                  >
                    <span>{deal.num_cards}</span>
                    <span
                      style={{
                        color: sc,
                        fontSize:
                          deal.suit === "🚫"
                            ? fluid(10, 2.8, 12)
                            : fluid(13, 3.6, 16),
                      }}
                    >
                      {deal.suit === "🚫" ? "NT" : deal.suit}
                    </span>
                  </div>
                  {players.map((p, pIdx) => {
                    const turn = turns.find((tt) => tt.player?.id === p!.id);
                    const active = isCurrent && p!.id === currentPlayerId;
                    const made =
                      turn?.score !== null &&
                      turn?.score !== undefined &&
                      turn?.bid !== null &&
                      turn?.bid !== undefined &&
                      turn.score > 10;
                    return (
                      <div
                        key={p!.id}
                        style={{
                          borderRight:
                            pIdx < players.length - 1
                              ? `1px solid ${alpha(t.gold, 0.06)}`
                              : "none",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontFamily: t.mono,
                          fontSize: cellFont,
                          color: made
                            ? t.pos
                            : isPast
                            ? t.cream
                            : isCurrent
                            ? t.gold
                            : t.cream,
                          opacity: isPast ? 0.65 : isCurrent ? 1 : 0.3,
                          position: "relative",
                        }}
                      >
                        {active && stage === "bid" && (
                          <div
                            style={{
                              position: "absolute",
                              inset: 3,
                              border: `1px solid ${t.gold}`,
                              borderRadius: 4,
                              pointerEvents: "none",
                            }}
                          />
                        )}
                        {turn?.bid !== null && turn?.bid !== undefined ? (
                          <span>
                            <span style={{ opacity: 0.55 }}>{turn.bid}</span>
                            {turn.score !== null &&
                              turn.score !== undefined && (
                                <>
                                  <span
                                    style={{ opacity: 0.4, margin: "0 2px" }}
                                  >
                                    ·
                                  </span>
                                  <span
                                    style={{ fontWeight: made ? 700 : 500 }}
                                  >
                                    {turn.score > 10 ? turn.score : turn.score}
                                  </span>
                                </>
                              )}
                          </span>
                        ) : active && stage === "bid" ? (
                          <span style={{ opacity: 0.8 }}>•</span>
                        ) : (
                          <span style={{ opacity: 0.3 }}>—</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* Input numpad */}
      {isOwnGame && bidOptions.length > 0 && (
        <div
          style={{
            padding: "12px 16px 14px",
            borderTop: `1px solid ${alpha(t.gold, 0.2)}`,
            background: alpha(t.shade, 0.3),
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontSize: fluid(10, 2.7, 12),
              color: t.gold,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              fontWeight: 700,
              marginBottom: 8,
              textAlign: "center",
              opacity: 0.75,
            }}
          >
            {currentPlayer?.name} ·{" "}
            {stage === "bid"
              ? `bid ${currentDeal.num_cards} tricks`
              : `tricks made`}
          </div>
          {stage === "bid" && bidOptions.some((o) => o.disabled) && (
            <div
              style={{
                fontSize: fluid(10, 2.7, 12),
                color: t.cream,
                opacity: 0.45,
                textAlign: "center",
                marginBottom: 8,
                fontStyle: "italic",
              }}
            >
              Last bidder can't make bids total {currentDeal.num_cards}
              <span style={{ color: sColor }}>{currentDeal.suit}</span>
            </div>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${bidOptions.length}, minmax(0, 1fr))`,
              gap: 6,
            }}
          >
            {bidOptions.map((opt) => (
              <button
                key={opt.number}
                disabled={opt.disabled}
                onClick={() =>
                  stage === "bid" ? handleBid(opt) : setTricksMade(opt.number)
                }
                style={{
                  minWidth: 0,
                  padding: "clamp(14px, 2.2vh, 20px) 0",
                  borderRadius: 10,
                  border: `1.5px solid ${
                    opt.disabled ? alpha(t.gold, 0.19) : t.gold
                  }`,
                  background: opt.disabled
                    ? "transparent"
                    : `linear-gradient(180deg, ${t.goldFill} 0%, ${t.goldDk} 100%)`,
                  color: opt.disabled ? alpha(t.gold, 0.5) : t.onGold,
                  fontFamily: t.display,
                  fontSize: `clamp(16px, 5.5vw, 22px)`,
                  fontWeight: 600,
                  textDecoration: opt.disabled ? "line-through" : "none",
                  boxShadow: opt.disabled
                    ? "none"
                    : `0 4px 12px ${alpha(
                        t.shade,
                        0.3
                      )}, inset 0 1px 0 rgba(255,255,255,0.3)`,
                }}
              >
                {opt.number}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
};

const WinScreen = ({
  players,
  onClose,
  onUndo,
  numRounds,
}: {
  players: { id: string; name: string; score: number; isWinner: boolean }[];
  onClose: () => void;
  onUndo?: () => void;
  numRounds: number;
}) => {
  const nav = useNavigate();
  const ranked = [...players].sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  return (
    <>
      <Confetti numberOfPieces={160} recycle={false} />
      <Crumb
        trail={[{ label: "Home", to: "/" }, { label: "Final score" }]}
        right={
          onUndo ? (
            <button
              onClick={onUndo}
              style={{
                fontSize: 10,
                color: t.gold,
                border: `1px solid ${alpha(t.gold, 0.33)}`,
                padding: "4px 8px",
                borderRadius: 14,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                background: "transparent",
              }}
            >
              Undo
            </button>
          ) : undefined
        }
      />
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "20px 20px 16px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: t.gold,
            letterSpacing: "0.25em",
            textTransform: "uppercase",
            fontWeight: 700,
            marginBottom: 8,
          }}
        >
          Game won
        </div>
        <div
          style={{
            fontFamily: t.display,
            fontSize: 54,
            color: t.cream,
            fontWeight: 600,
            lineHeight: 1,
          }}
        >
          {winner.name}
        </div>
        <div
          style={{
            fontFamily: t.mono,
            fontSize: 36,
            color: t.gold,
            marginTop: 10,
            fontWeight: 700,
          }}
        >
          {winner.score}
        </div>
        <div
          style={{ fontSize: 12, color: t.cream, opacity: 0.6, marginTop: 4 }}
        >
          {numRounds} rounds
        </div>

        <div style={{ marginTop: 22, textAlign: "left" }}>
          {ranked.map((p, i) => (
            <div
              key={p.id}
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                marginBottom: 6,
                background: p.isWinner
                  ? alpha(t.gold, 0.09)
                  : alpha(t.shade, 0.22),
                border: `1px solid ${
                  p.isWinner ? alpha(t.gold, 0.33) : alpha(t.gold, 0.13)
                }`,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  background: p.isWinner ? t.goldFill : "transparent",
                  border: p.isWinner
                    ? "none"
                    : `1px solid ${alpha(t.gold, 0.27)}`,
                  color: p.isWinner ? t.onGold : t.gold,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: t.display,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {i + 1}
              </div>
              <div
                style={{
                  flex: 1,
                  fontFamily: t.display,
                  fontSize: 15,
                  color: t.cream,
                  fontWeight: 600,
                }}
              >
                {p.name}
              </div>
              <div
                style={{
                  fontFamily: t.mono,
                  fontSize: 16,
                  color: p.isWinner ? t.gold : t.cream,
                  fontWeight: 700,
                }}
              >
                {p.score}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          padding: "10px 16px 14px",
          borderTop: `1px solid ${alpha(t.gold, 0.13)}`,
          display: "flex",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onClose}
          style={{
            flex: 1,
            padding: "12px",
            borderRadius: 12,
            textAlign: "center",
            border: `1px solid ${alpha(t.gold, 0.33)}`,
            color: t.gold,
            background: "transparent",
            fontFamily: t.display,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          View scorecard
        </button>
        <button
          onClick={() => nav("/")}
          style={{
            ...goldButton,
            flex: 2,
            padding: "12px",
            borderRadius: 12,
            fontSize: 14,
          }}
        >
          + New game
        </button>
      </div>
    </>
  );
};
