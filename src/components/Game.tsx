import { Fragment, useEffect, useRef, useState } from "react";

import { useParams } from "react-router-dom";

import { push, ref, remove, set } from "firebase/database";
import {
  useList,
  useListKeys,
  useObjectVal,
} from "react-firebase-hooks/database";
import { db } from "..";
import { DEALS } from "../constants";
import { Deal, Game, Player, Round, Turn } from "../types";

export const GameComp = () => {
  const { gameId } = useParams<{ gameId: string }>();

  const [isClosed, setIsClosed] = useState(false);

  const [game, l1, error] = useObjectVal<Game>(ref(db, "games/" + gameId));
  const [players, l2, r] = useListKeys(ref(db, "players/" + gameId));
  const [rs, l3, er] = useList(ref(db, "rounds/" + gameId));

  if (l1 || l2 || l3) {
    return null;
  }
  if (!game || !players || !players.length) {
    return null;
  }

  if ((rs?.length ?? 0) > DEALS.length) {
    return <div>finished</div>;
  }

  const addPlayer = () => {
    const pRef = ref(db, "players/" + gameId);
    push(pRef, true);
  };

  const removePlayer = (playerId: string) => {
    remove(ref(db, "players/" + gameId + "/" + playerId));
  };

  const currentRoundIdx = rs?.length
    ? Object.values(rs[rs.length - 1].val()).every(
        (t) => (t as Turn).score !== undefined
      )
      ? rs.length
      : rs.length - 1
    : 0;

  const currentRound = (
    rs?.length ? rs[currentRoundIdx]?.val() ?? null : null
  ) as Round | null;

  const dealerIdx = getDealerIdx(currentRoundIdx, players);

  const currentPlayerId = getCurrentPlayerIdFromRound(
    currentRound,
    dealerIdx,
    players
  );

  const numTurns = currentRound ? Object.keys(currentRound).length : 0;

  const stage: "bid" | "score" = numTurns === players.length ? "score" : "bid";

  const getScoreForPlayer = (playerId: string) => {
    return rs?.length
      ? rs.reduce((prev, curr) => {
          const turn = curr.val()[playerId];
          if (!turn) {
            return prev;
          }
          return prev + (turn.score ?? 0);
        }, 0 as any)
      : 0;
  };

  const handleClick = async (opt: { number: number; disabled: boolean }) => {
    if (!opt.disabled && currentPlayerId !== null) {
      const r =
        rs?.[currentRoundIdx] !== undefined
          ? rs[currentRoundIdx].key
          : (await push(ref(db, "rounds/" + gameId))).key;

      set(ref(db, "rounds/" + gameId + "/" + r + "/" + currentPlayerId), {
        bid: opt.number,
      });
    }
  };

  const setTricksMade = async (tricks: number) => {
    if (currentPlayerId !== null) {
      const r =
        rs?.[currentRoundIdx] !== undefined
          ? rs[currentRoundIdx].key
          : (await push(ref(db, "rounds/" + gameId))).key;

      const score =
        currentRound?.[currentPlayerId].bid === tricks ? tricks + 10 : tricks;

      set(
        ref(
          db,
          "rounds/" + gameId + "/" + r + "/" + currentPlayerId + "/score"
        ),
        score
      );
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
      Object.values(round_to_undo).every(
        (t) => t.bid === undefined && t.score === undefined
      )
    ) {
      round_idx -= 1;
      round_to_undo = rs?.[round_idx].val();
    }

    // back to the start
    if (!round_to_undo) {
      return;
    }

    // work out who's turn it is, 0th player changes each round
    const dealerIdx = getDealerIdx(round_idx, players);
    let player = getCurrentPlayerIdFromRound(round_to_undo, dealerIdx, players);
    if (!player) {
      const last_player_idx = round_idx % players.length;
      player = players[last_player_idx];
    }

    // get the previous turn idx

    let player_idx = players.indexOf(player);
    player_idx -= 1;
    if (player_idx < 0) {
      player_idx = players.length - 1;
    }

    // and the previous turn
    const playerToUndo = players[player_idx];

    // work out which stage we're on
    if (
      (round_to_undo[playerToUndo] as Turn | undefined)?.score !== undefined
    ) {
      round_to_undo[playerToUndo].score = undefined;

      await remove(
        ref(
          db,
          "rounds/" +
            gameId +
            "/" +
            rs?.[round_idx].key +
            "/" +
            playerToUndo +
            "/score"
        )
      );
      return;
    }

    await remove(
      ref(
        db,
        "rounds/" +
          gameId +
          "/" +
          rs?.[round_idx].key +
          "/" +
          playerToUndo +
          "/bid"
      )
    );
    round_to_undo[playerToUndo].bid = undefined;
  };

  const bidOptions = getBidOptions(
    currentRound,
    currentRoundIdx,
    players,
    stage
  );
  const scores = players.map((p) => getScoreForPlayer(p));
  const winningScore = scores.findIndex((s) => s === Math.max(...scores));
  const winningPlayer = null;
  return (
    <>
      {/* {currentRoundIdx === null && !isClosed && (
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
          <Confetti />
        </>
      )} */}
      <div className="flex justify-end space-x-2 px-1 my-1">
        <button
          className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900"
          onClick={addPlayer}
        >
          Add player
        </button>
        {/* <button
          className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900"
          onClick={removePlayer}
        >
          Remove player
        </button> */}
        <button
          className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900"
          onClick={undo}
        >
          Undo
        </button>
      </div>
      <div
        className={`grid grid-cols-${players.length + 1} flex-grow`}
        style={{
          gridTemplateColumns: `repeat(${players.length + 1}, minmax(0, 1fr))`,
        }}
      >
        <div></div>
        {players.map((p, idx) => (
          <PlayerComp id={p} key={p} isDealer={idx === dealerIdx} />
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
                  key={p}
                  className={`text-xl border-b ${
                    p_idx === players.length ? "" : "border-r"
                  } border-gray-400 flex justify-center items-center text-center`}
                >
                  <div
                    className={`${
                      currentPlayerId === p &&
                      currentRoundIdx === t_idx &&
                      stage === "bid"
                        ? "bg-green-300"
                        : ""
                    } h-full flex items-center justify-center flex-grow w-full border-r`}
                  >
                    {rs?.[t_idx]?.val()[p]?.bid}
                  </div>
                  <div
                    className={`${
                      currentPlayerId === p &&
                      currentRoundIdx === t_idx &&
                      stage === "score"
                        ? "bg-green-300"
                        : ""
                    } h-full flex items-center justify-center flex-grow w-full `}
                  >
                    {rs?.[t_idx]?.val()[p]?.score}
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
              {getScoreForPlayer(p)}
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
                onClick={() => handleClick(opt)}
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

const getDealerIdx = (roundIdx: number | null, players: string[]) => {
  return roundIdx !== null
    ? (roundIdx + players.length - 1) % players.length
    : null;
};

const PlayerComp = ({ id, isDealer }: { id: string; isDealer: boolean }) => {
  const { gameId } = useParams();
  const [temp_name, changeTempName] = useState("");
  const [changing_name, setChangingName] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const [player, loading, error] = useObjectVal<Player>(
    ref(db, "/players/" + gameId + "/" + id)
  );

  useEffect(() => {
    if (input.current) {
      input.current.select();
    }
  }, [changing_name]);

  const handleChangePlayer = async (e) => {
    await set(ref(db, "/players/" + gameId + "/" + id), { name: temp_name });

    setChangingName(false);
  };

  return (
    <div className={`${isDealer ? "bg-red-500" : ""} text-center text-xs`}>
      {changing_name ? (
        <input
          className="w-full h-full text-center"
          ref={input}
          value={temp_name}
          onChange={(e) => changeTempName(e.target.value)}
          onBlur={handleChangePlayer}
        />
      ) : (
        <button
          onFocus={() => setChangingName(true)}
          className="w-full h-full p-1 truncate"
          onClick={() => setChangingName(true)}
        >
          {player ? player.name : id}
        </button>
      )}
    </div>
  );
};

const getBidOptions = (
  currentRound: Round | null,
  currentRoundIdx: number,
  players: string[],
  stage: "score" | "bid"
): { number: number; disabled: boolean }[] => {
  const all_options = [
    { number: 0, disabled: false },
    { number: 1, disabled: false },
    { number: 2, disabled: false },
    { number: 3, disabled: false },
    { number: 4, disabled: false },
    { number: 5, disabled: false },
    { number: 6, disabled: false },
    { number: 7, disabled: false },
  ];
  const turn: Deal | undefined = DEALS[currentRoundIdx];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!turn) {
    return [];
  }

  const bids_left = currentRound
    ? players.length - Object.values(currentRound).length
    : players.length;

  const options = all_options.filter((o) => o.number <= turn.num_cards);
  if (stage === "score") {
    return options;
  }
  if (bids_left !== 1) {
    return options;
  }

  const sum_bids = currentRound
    ? Object.values(currentRound).reduce((acc, turn) => {
        return acc + (turn.bid ?? 0);
      }, 0)
    : 0;

  if (turn.num_cards < sum_bids) {
    return options;
  }

  const cant_say = turn.num_cards - sum_bids;
  options.forEach((o) => {
    if (o.number === cant_say) {
      o.disabled = true;
    }
  });
  return options;
};

const getCurrentPlayerIdFromRound = (
  round: Round | null,
  dealerIdx: number | null,
  players: string[]
): string | null => {
  if (dealerIdx === null) {
    return players[0];
  }
  const startingPlayerIdx = (dealerIdx + 1) % players.length;

  const orderedPlayers = [
    ...players.slice(startingPlayerIdx),
    ...players.slice(0, startingPlayerIdx),
  ];

  if (!round) {
    return orderedPlayers[0];
  }

  const playerId =
    orderedPlayers.find(
      (p) => (round[p] as Turn | undefined)?.bid === undefined
    ) ??
    orderedPlayers.find(
      (p) => (round[p] as Turn | undefined)?.score === undefined
    ) ??
    null ??
    null;

  return playerId;
};
