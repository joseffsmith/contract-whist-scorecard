import { Fragment, useEffect, useState } from "react";
import Confetti from "react-confetti";
import { useNavigate, useParams } from "react-router-dom";
import { DEALS } from "../constants";
import {
  clearScore,
  createGame,
  deleteTurn,
  setBid,
  setScore,
} from "../guest/guestStore";
import { useGuestGame } from "../guest/useGuestGame";
import { goldButton, suitColor, t } from "../theme/tokens";
import { getBidOptions } from "../utils/getBidOptions";
import { getCurrentPlayerIdFromRound } from "../utils/getCurrentPlayerIdFromRound";
import { getDealerIdx } from "../utils/getDealerIdx";
import { Crumb } from "./chrome/Crumb";

export const GuestGameComp = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const game = useGuestGame(gameId);
  const [isConfettiClosed, setIsClosed] = useState(false);

  useEffect(() => {
    if (!gameId) navigate("/login");
  }, [gameId, navigate]);

  if (!game) {
    return (
      <>
        <Crumb trail={[{ label: "Guest", to: "/login" }, { label: "Game" }]} />
        <div style={{ padding: 20, opacity: 0.6 }}>Game not found.</div>
      </>
    );
  }

  const players = game.players;
  const numPlayers = players.length;
  const rs = [...game.rounds].sort((a, b) => a.roundNumber - b.roundNumber);

  const initialDealerIdx =
    players.findIndex((p) => p.id === game.initialDealerId) ?? null;
  const initialDealerIdxOrNull =
    initialDealerIdx === -1 ? null : initialDealerIdx;

  const isGameFinished =
    rs.length > 0 &&
    rs.every(
      (r) =>
        r.turns.length === numPlayers &&
        r.turns.every((x) => x.score !== null)
    );

  const lastRound = isGameFinished
    ? rs[rs.length - 1]
    : rs.find(
        (r) =>
          r.turns.length !== numPlayers ||
          r.turns.some((x) => x.score === null)
      ) ?? rs[0];
  const currentRoundIdx = lastRound.roundNumber;

  const currentRound = rs[currentRoundIdx] ?? null;
  const dealerIdx = getDealerIdx(
    currentRoundIdx,
    numPlayers,
    initialDealerIdxOrNull
  );

  // getCurrentPlayerIdFromRound expects round.turns[].player.id — shape guest turns into that.
  const shapedRound = currentRound
    ? {
        ...currentRound,
        turns: currentRound.turns.map((tt) => ({
          ...tt,
          player: { id: tt.playerId },
        })),
      }
    : null;

  const currentPlayerId = getCurrentPlayerIdFromRound(
    shapedRound as any,
    dealerIdx,
    players as any
  );

  const numTurns = currentRound?.turns.length ?? 0;
  const stage: "bid" | "score" = numTurns === numPlayers ? "score" : "bid";

  const scoreFor = (playerId: string) =>
    rs.reduce((acc, r) => {
      const turn = r.turns.find((tt) => tt.playerId === playerId);
      return acc + (turn?.score ?? 0);
    }, 0);

  const scores = players.map((p) => scoreFor(p.id));
  const leadScore = Math.max(...scores, 0);
  const winnerIdx = scores.findIndex((s) => s === leadScore);

  const handleBid = (opt: { number: number; disabled: boolean }) => {
    if (opt.disabled || !currentPlayerId || !currentRound) return;
    setBid(game.id, currentRound.id, currentPlayerId, opt.number);
  };

  const handleScore = (tricks: number) => {
    if (!currentPlayerId || !currentRound) return;
    const turn = currentRound.turns.find(
      (tt) => tt.playerId === currentPlayerId
    );
    if (!turn) return;
    const score = turn.bid === tricks ? tricks + 10 : tricks;
    setScore(game.id, turn.id, score);
  };

  const undo = () => {
    let roundToUndo = currentRound;
    let roundIdx = currentRoundIdx;
    if (
      !roundToUndo ||
      roundToUndo.turns.every(
        (tt) => tt.bid === null && tt.score === null
      )
    ) {
      roundIdx -= 1;
      roundToUndo = rs[roundIdx] ?? null;
    }
    if (!roundToUndo) return;

    const d = getDealerIdx(roundIdx, numPlayers, initialDealerIdxOrNull);
    const shaped = {
      ...roundToUndo,
      turns: roundToUndo.turns.map((tt) => ({
        ...tt,
        player: { id: tt.playerId },
      })),
    };
    let player = getCurrentPlayerIdFromRound(
      shaped as any,
      d,
      players as any
    );
    if (!player) player = players[(d + 1) % numPlayers]?.id ?? null;

    let playerIdx = players.findIndex((p) => p.id === player);
    playerIdx -= 1;
    if (playerIdx < 0) playerIdx = numPlayers - 1;
    const playerToUndo = players[playerIdx];

    const turnToUndo = roundToUndo.turns.find(
      (tt) => tt.playerId === playerToUndo?.id
    );
    if (!turnToUndo) return;
    if (turnToUndo.score !== null) {
      clearScore(game.id, turnToUndo.id);
      return;
    }
    deleteTurn(game.id, turnToUndo.id);
  };

  const bidOptions = getBidOptions(
    shapedRound as any,
    currentRoundIdx,
    players as any,
    stage
  );

  // ─── Win screen takeover ───
  if (isGameFinished && !isConfettiClosed) {
    return (
      <WinScreen
        players={players.map((p, i) => ({
          id: p.id,
          name: p.name,
          score: scores[i],
          isWinner: i === winnerIdx,
        }))}
        onClose={() => setIsClosed(true)}
        onUndo={undo}
        numRounds={rs.length}
        onNewGame={() => {
          const g = createGame();
          navigate(`/games/guest/${g.id}/manage`);
        }}
      />
    );
  }

  const currentDeal = DEALS[currentRoundIdx];
  const sColor = suitColor(currentDeal?.suit ?? "");
  const currentPlayer = players.find((p) => p.id === currentPlayerId);
  const dealer = players[dealerIdx];
  const bidsIn = currentRound?.turns.length ?? 0;
  const scoredCount =
    currentRound?.turns.filter((tt) => tt.score !== null).length ?? 0;

  return (
    <>
      <Crumb
        trail={[
          { label: "Guest", to: "/login" },
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
          <button
            onClick={undo}
            style={{
              fontSize: 10,
              color: t.gold,
              border: `1px solid ${t.gold}55`,
              padding: "4px 8px",
              borderRadius: 14,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              background: "transparent",
            }}
          >
            Undo
          </button>
        }
      />

      {/* Hero */}
      <div
        style={{
          margin: "12px 16px 0",
          padding: "14px 16px",
          borderRadius: 12,
          background: `linear-gradient(180deg, ${t.panel}, ${t.panelDk})`,
          color: t.ink,
          boxShadow:
            "0 10px 30px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.5)",
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
            color: `${sColor}22`,
            lineHeight: 1,
            fontWeight: 700,
          }}
        >
          {currentDeal.suit}
        </div>
        <div
          style={{
            fontSize: 10,
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
            fontSize: 28,
            fontWeight: 600,
            color: t.ink,
            marginTop: 2,
            lineHeight: 1,
          }}
        >
          {currentPlayer?.name ?? "—"}
        </div>
        <div style={{ fontSize: 12, color: t.ink2, marginTop: 4 }}>
          {dealer ? `${dealer.name} dealt` : ""} ·{" "}
          {stage === "bid"
            ? `${bidsIn} of ${numPlayers} bid`
            : `${scoredCount} of ${numPlayers} scored`}
        </div>
      </div>

      {/* Player chips */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${numPlayers}, 1fr)`,
          gap: 6,
          padding: "10px 16px 0",
          flexShrink: 0,
        }}
      >
        {players.map((p, i) => {
          const isLead = scores[i] === leadScore && leadScore > 0;
          const isTurn = p.id === currentPlayerId;
          return (
            <div
              key={p.id}
              style={{
                padding: "6px 4px",
                borderRadius: 8,
                textAlign: "center",
                background: isTurn ? `${t.gold}22` : "transparent",
                border: `1px solid ${isTurn ? t.gold : t.gold + "22"}`,
              }}
            >
              <div style={{ fontSize: 10, color: t.cream, opacity: 0.8 }}>
                {p.name}
              </div>
              <div
                style={{
                  fontFamily: t.mono,
                  fontSize: 16,
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
        }}
      >
        <div
          style={{
            borderRadius: 10,
            overflow: "hidden",
            border: `1px solid ${t.gold}22`,
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
                    gridTemplateColumns: `40px repeat(${numPlayers}, 1fr)`,
                    borderBottom:
                      rIdx < DEALS.length - 1
                        ? `1px solid ${t.gold}15`
                        : "none",
                    background: isCurrent ? `${t.gold}15` : "transparent",
                    minHeight: 32,
                  }}
                >
                  <div
                    style={{
                      padding: "5px 6px",
                      fontFamily: t.mono,
                      fontSize: 12,
                      color: isCurrent ? t.gold : t.cream,
                      opacity: isPast ? 0.5 : 1,
                      borderRight: `1px solid ${t.gold}15`,
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
                        fontSize: deal.suit === "🚫" ? 10 : 13,
                      }}
                    >
                      {deal.suit === "🚫" ? "NT" : deal.suit}
                    </span>
                  </div>
                  {players.map((p, pIdx) => {
                    const turn = turns.find((tt) => tt.playerId === p.id);
                    const active = isCurrent && p.id === currentPlayerId;
                    const made =
                      turn?.score !== null &&
                      turn?.score !== undefined &&
                      turn?.bid !== null &&
                      turn?.bid !== undefined &&
                      turn.score > 10;
                    return (
                      <div
                        key={p.id}
                        style={{
                          borderRight:
                            pIdx < numPlayers - 1
                              ? `1px solid ${t.gold}10`
                              : "none",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontFamily: t.mono,
                          fontSize: 12,
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
                            {turn.score !== null && turn.score !== undefined && (
                              <>
                                <span style={{ opacity: 0.4, margin: "0 2px" }}>
                                  ·
                                </span>
                                <span style={{ fontWeight: made ? 700 : 500 }}>
                                  {turn.score}
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
      {bidOptions.length > 0 && (
        <div
          style={{
            padding: "12px 16px 14px",
            borderTop: `1px solid ${t.gold}33`,
            background: "rgba(0,0,0,0.3)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontSize: 10,
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
                fontSize: 10,
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
                  stage === "bid" ? handleBid(opt) : handleScore(opt.number)
                }
                style={{
                  minWidth: 0,
                  padding: "14px 0",
                  borderRadius: 10,
                  border: `1.5px solid ${
                    opt.disabled ? t.gold + "30" : t.gold
                  }`,
                  background: opt.disabled
                    ? "transparent"
                    : `linear-gradient(180deg, ${t.gold} 0%, ${t.goldDk} 100%)`,
                  color: opt.disabled ? t.gold + "80" : t.feltDk,
                  fontFamily: t.display,
                  fontSize: `clamp(16px, 5.5vw, 22px)`,
                  fontWeight: 600,
                  textDecoration: opt.disabled ? "line-through" : "none",
                  boxShadow: opt.disabled
                    ? "none"
                    : "0 4px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.3)",
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
  onNewGame,
}: {
  players: { id: string; name: string; score: number; isWinner: boolean }[];
  onClose: () => void;
  onUndo: () => void;
  numRounds: number;
  onNewGame: () => void;
}) => {
  const ranked = [...players].sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  return (
    <>
      <Confetti numberOfPieces={160} recycle={false} />
      <Crumb
        trail={[{ label: "Guest", to: "/login" }, { label: "Final score" }]}
        right={
          <button
            onClick={onUndo}
            style={{
              fontSize: 10,
              color: t.gold,
              border: `1px solid ${t.gold}55`,
              padding: "4px 8px",
              borderRadius: 14,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              background: "transparent",
            }}
          >
            Undo
          </button>
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
        <div style={{ fontSize: 12, color: t.cream, opacity: 0.6, marginTop: 4 }}>
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
                background: p.isWinner ? `${t.gold}18` : "rgba(0,0,0,0.22)",
                border: `1px solid ${
                  p.isWinner ? t.gold + "55" : t.gold + "22"
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
                  background: p.isWinner ? t.gold : "transparent",
                  border: p.isWinner ? "none" : `1px solid ${t.gold}44`,
                  color: p.isWinner ? t.feltDk : t.gold,
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
          borderTop: `1px solid ${t.gold}22`,
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
            border: `1px solid ${t.gold}55`,
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
          onClick={onNewGame}
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
