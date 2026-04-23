import { id } from "@instantdb/react";
import { Fragment, useEffect, useState } from "react";
import Confetti from "react-confetti";
import { useNavigate, useParams } from "react-router-dom";
import { DEALS } from "../constants";
import { db } from "../db";
import { queryGameData } from "../queries";
import { goldButton, suitColor, t } from "../theme/tokens";
import { getBidOptions } from "../utils/getBidOptions";
import { getCurrentPlayerIdFromRound } from "../utils/getCurrentPlayerIdFromRound";
import { getDealerIdx } from "../utils/getDealerIdx";
import { Crumb } from "./chrome/Crumb";

export const GameComp = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const [isConfettiClosed, setIsClosed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const { isLoading: isLoadingUser, user } = db.useAuth();
  const { isLoading, data } = db.useQuery(
    gameId ? queryGameData(gameId) : null
  );

  useEffect(() => {
    if (!gameId) navigate("/");
  }, [gameId, navigate]);

  if (!data || isLoadingUser || isLoading) {
    return (
      <>
        <Crumb trail={[{ label: "Home", to: "/" }, { label: "Game" }]} />
        <div style={{ padding: 20, opacity: 0.6 }}>Loading…</div>
      </>
    );
  }

  const game = data.games[0];
  const initialDealerId = game.initialDealerId;
  const initialDealerIdx =
    game.playersOrders.find((po) => po.player?.id === initialDealerId)
      ?.orderNumber ?? null;

  const rs = game.rounds.sort((a, b) => a.roundNumber - b.roundNumber);
  const numPlayers = Object.values(game.playersOrders).length;

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
    .flatMap((p) => p.player!);

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
  const isOwnGame = user?.id === game.createdBy;

  const handleBid = async (opt: { number: number; disabled: boolean }) => {
    if (!opt.disabled && currentPlayerId !== null) {
      await db.transact([
        db.tx.turns[id()]
          .update({ bid: opt.number })
          .link({ player: currentPlayerId, round: currentRound!.id }),
      ]);
    }
  };

  const setTricksMade = async (tricks: number) => {
    if (currentPlayerId !== null) {
      const turn = currentRound?.turns.find(
        (tt) => tt.player?.id === currentPlayerId
      );
      const score = turn?.bid === tricks ? tricks + 10 : tricks;
      await db.transact([db.tx.turns[turn!.id].update({ score })]);
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
      await db.transact([db.tx.turns[turnToUndo.id].update({ score: null })]);
      return;
    }
    await db.transact([
      db.tx.turns[
        round_to_undo.turns.find((p) => p.player?.id === playerToUndo?.id)!.id
      ].delete(),
    ]);
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
          <div style={{ display: "flex", gap: 6, position: "relative" }}>
            {isOwnGame && (
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
            )}
            <button
              onClick={() => setMoreOpen((v) => !v)}
              aria-label="More"
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                border: `1px solid ${t.gold}55`,
                color: t.gold,
                background: "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
              }}
            >
              ⋯
            </button>
            {moreOpen && isOwnGame && (
              <div
                style={{
                  position: "absolute",
                  top: 32,
                  right: 0,
                  padding: 4,
                  borderRadius: 8,
                  background: t.feltDk,
                  border: `1px solid ${t.gold}55`,
                  boxShadow: "0 10px 20px rgba(0,0,0,0.5)",
                  minWidth: 140,
                  zIndex: 10,
                }}
              >
                <div
                  onClick={() => {
                    setMoreOpen(false);
                    navigate(`/games/${gameId}/manage`);
                  }}
                  style={{
                    padding: "8px 12px",
                    fontSize: 13,
                    color: t.cream,
                    cursor: "pointer",
                  }}
                >
                  Manage players
                </div>
              </div>
            )}
          </div>
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
            color: `${sColor === t.cream ? t.feltDk : sColor}22`,
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
                background: isTurn ? `${t.gold}22` : "transparent",
                border: `1px solid ${isTurn ? t.gold : t.gold + "22"}`,
              }}
            >
              <div style={{ fontSize: 10, color: t.cream, opacity: 0.8 }}>
                {p!.name}
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
                    gridTemplateColumns: `40px repeat(${players.length}, 1fr)`,
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
                                  {turn.score > 10
                                    ? turn.score
                                    : turn.score}
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
                  stage === "bid" ? handleBid(opt) : setTricksMade(opt.number)
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
