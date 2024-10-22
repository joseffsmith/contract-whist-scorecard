import { id, tx } from "@instantdb/react";
import { Typography } from "@mui/joy";
import { Fragment, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { db } from "..";
import { DEALS } from "../constants";
import { Player, PlayersOrders, Round } from "../types";
import { getBidOptions } from "../utils/getBidOptions";
import { getCurrentPlayerIdFromRound } from "../utils/getCurrentPlayerIdFromRound";
import { getDealerIdx } from "../utils/getDealerIdx";

export const GameComp = () => {
  const { gameId } = useParams<{ gameId: string }>();

  const [isConfettiClosed, setIsClosed] = useState(false);

  const { isLoading: isLoadingUser, user, error: errorAuth } = db.useAuth();
  const { isLoading, error, data } = db.useQuery({
    games: {
      playersOrders: {
        player: {},
      },
      rounds: {
        turns: {
          player: {},
        },
      },
      $: {
        where: {
          id: gameId!,
        },
      },
    },
  });

  if (!gameId) {
    throw Error("No game id");
  }

  if (!data || isLoadingUser) {
    return <div>Loading...</div>;
  }

  const game = data.games[0];
  const initialDealerId = game.initialDealerId;

  const initialDealerIdx =
    game.playersOrders.find((po) => po.player?.[0]?.id === initialDealerId)
      ?.orderNumber ?? null;

  const rs = game.rounds.sort((a, b) => a.roundNumber - b.roundNumber);

  const numPlayers = Object.values(game.playersOrders).length;
  const lastRound =
    rs.find((r) => {
      return (
        r.turns.length !== numPlayers ||
        r.turns.some((t) => t.score === undefined || t.score === null)
      );
    }) ?? rs[0];
  const currentRoundIdx = lastRound.roundNumber;

  const currentRound = (
    rs.length ? rs[currentRoundIdx] ?? null : null
  ) as Round | null;

  const dealerIdx = getDealerIdx(currentRoundIdx, numPlayers, initialDealerIdx);

  const players: Player[] = (
    Object.values(game.playersOrders) as PlayersOrders[]
  )
    .sort((apo, bpo) => apo.orderNumber - bpo.orderNumber)
    .flatMap((p) => p.player);

  const currentPlayerId = getCurrentPlayerIdFromRound(
    currentRound,
    dealerIdx,
    players
  );

  const numTurns = currentRound ? currentRound.turns.length : 0;

  const stage: "bid" | "score" = numTurns === players.length ? "score" : "bid";

  const getScoreForPlayer = (playerId: string) => {
    return rs.length
      ? rs.reduce((prev, curr) => {
          const turn = curr.turns.find((t) => t.player[0].id === playerId);
          if (!turn) {
            return prev;
          }
          return prev + (turn.score ?? 0);
        }, 0 as any)
      : 0;
  };

  const handleBid = async (opt: { number: number; disabled: boolean }) => {
    if (!opt.disabled && currentPlayerId !== null) {
      const res = await db.transact([
        tx.turns[id()]
          .update({
            bid: opt.number,
          })
          .link({ player: currentPlayerId, round: currentRound!.id }),
      ]);
    }
  };

  const setTricksMade = async (tricks: number) => {
    if (currentPlayerId !== null) {
      const turn = currentRound?.turns.find(
        (t) => t.player[0].id === currentPlayerId
      );
      const score = turn?.bid === tricks ? tricks + 10 : tricks;

      const res = await db.transact([
        tx.turns[turn!.id].merge({
          score,
        }),
      ]);
    }
  };

  const undo = async () => {
    // TODO flip this around
    // start with the simplest case, same round and stage
    // if we need to wrap around, it's still the same round if the stage is score
    // if it's not score then we need to flip to bid and jump back a round

    // work out the round to undo first
    let round_to_undo = currentRound;
    let round_idx = currentRoundIdx;
    if (
      !round_to_undo ||
      round_to_undo.turns.every(
        (t) =>
          (t.bid === undefined || t.bid === null) &&
          (t.score === undefined || t.score === null)
      )
    ) {
      round_idx -= 1;
      round_to_undo = rs[round_idx] ?? null;
    }

    // back to the start
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!round_to_undo) {
      return;
    }

    // work out who's turn it is, 0th player changes each round
    const dealerIdx = getDealerIdx(round_idx, players.length, initialDealerIdx);
    let player = getCurrentPlayerIdFromRound(round_to_undo, dealerIdx, players);
    if (!player) {
      const last_player_idx = round_idx % players.length;
      player = players[last_player_idx].id;
    }

    // get the previous turn idx

    let player_idx = players.findIndex((p) => p.id === player);
    player_idx -= 1;
    if (player_idx < 0) {
      player_idx = players.length - 1;
    }

    // and the previous turn
    const playerToUndo = players[player_idx];

    // work out which stage we're on
    const turnToUndo = round_to_undo.turns.find(
      (p) => p.player[0].id === playerToUndo.id
    );

    if (turnToUndo?.score !== undefined && turnToUndo.score !== null) {
      const res = await db.transact([
        tx.turns[turnToUndo.id].merge({
          score: undefined,
        }),
      ]);
      return;
    }

    const res = await db.transact([
      tx.turns[
        round_to_undo.turns.find((p) => p.player[0].id === playerToUndo.id)!.id
      ].delete(),
    ]);
  };

  const bidOptions = getBidOptions(
    currentRound,
    currentRoundIdx,
    players,
    stage
  );
  const scores = players.map((p) => getScoreForPlayer(p.id));
  const winningScore = scores.findIndex((s) => s === Math.max(...scores));
  const winningPlayer = null;

  return (
    <>
      {currentRoundIdx === null && !isConfettiClosed && (
        <>
          <div
            style={{
              position: "fixed",
              backgroundColor: "#fafafaaa",
              left: 0,
              right: 0,
              bottom: 0,
              top: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <h2 style={{ fontSize: "2em", fontWeight: "bold" }}>
              {winningPlayer} wins!
            </h2>
            <button
              className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900"
              onClick={(e) => {
                e.preventDefault();
                setIsClosed(true);
              }}
            >
              Close
            </button>
          </div>
          {/* <Confetti /> */}
        </>
      )}
      {user?.id === game.createdBy && (
        <div className="flex justify-end space-x-1 my-1">
          <button className="whitespace-nowrap border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900">
            <Link to={"manage"}>Manage</Link>
          </button>

          <button
            className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900"
            onClick={undo}
          >
            Undo
          </button>
        </div>
      )}
      <div
        className={`grid grid-cols-${players.length + 1} flex-grow`}
        style={{
          gridTemplateColumns: `repeat(${players.length + 1}, minmax(0, 1fr))`,
        }}
      >
        <div></div>

        {players.map((p, idx) => (
          <div
            key={p.id}
            className={`${
              dealerIdx === idx ? "bg-red-500" : ""
            } text-center text-xs flex items-center`}
          >
            <Typography
              sx={{ textAlign: "center", width: "100%" }}
              level="body-md"
            >
              {p.name}
            </Typography>
          </div>
        ))}

        {DEALS.map((t, t_idx) => (
          <Fragment key={t_idx}>
            <div className={`flex items-center pl-2`}>
              <div className="font-semibold text-lg w-3 text-center">
                {t.num_cards}
              </div>
              <span className={`${t.suit_colour} text-xl w-6 text-center`}>
                {t.suit}
              </span>
            </div>

            {players.map((p, p_idx) => {
              return (
                <div
                  key={p.id}
                  className={`text-xl border-b ${
                    p_idx === players.length ? "" : "border-r"
                  } border-gray-400 flex justify-center items-center text-center`}
                >
                  <div
                    className={`${
                      currentPlayerId === p.id &&
                      currentRoundIdx === t_idx &&
                      stage === "bid"
                        ? "bg-green-300"
                        : ""
                    } h-full flex items-center justify-center flex-grow w-full border-r`}
                  >
                    {rs[t_idx].turns.find((t) => t.player[0].id === p.id)?.bid}
                  </div>
                  <div
                    className={`${
                      currentPlayerId === p.id &&
                      currentRoundIdx === t_idx &&
                      stage === "score"
                        ? "bg-green-300"
                        : ""
                    } h-full flex items-center justify-center flex-grow w-full `}
                  >
                    {
                      rs[t_idx].turns.find((t) => t.player[0].id === p.id)
                        ?.score
                    }
                  </div>
                </div>
              );
            })}
          </Fragment>
        ))}

        <div className="text-center">Totals</div>
        {players.map((p, idx) => {
          return (
            <div
              key={idx}
              className="text-xl text-center border-r border-gray-400 last:border-r-0 "
            >
              {getScoreForPlayer(p.id)}
            </div>
          );
        })}
      </div>

      {stage === "bid" && (
        <div className="flex justify-between w-full">
          {bidOptions.map((opt) => {
            return (
              <button
                key={opt.number}
                onClick={() => handleBid(opt)}
                className={`${
                  opt.disabled
                    ? "border-purple-50 bg-white opacity-50"
                    : "border-gray-900 bg-indigo-100"
                } border rounded-sm  py-2 flex-1 m-0.5`}
              >
                {opt.number}
              </button>
            );
          })}
        </div>
      )}

      {stage === "score" && (
        <div className="flex justify-between w-full">
          {bidOptions.map((opt) => {
            return (
              <button
                key={opt.number}
                onClick={() => setTricksMade(opt.number)}
                className="border-gray-900 bg-indigo-100 border rounded-sm py-2 flex-1 m-0.5"
              >
                {opt.number}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
};
