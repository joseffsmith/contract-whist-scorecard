import { Fragment, useEffect, useRef, useState } from "react";

import { useParams } from "react-router-dom";

import {
  Autocomplete,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  Dropdown,
  FormControl,
  FormLabel,
  Input,
  Modal,
  ModalDialog,
  Radio,
  RadioGroup,
  Switch,
} from "@mui/joy";

import { DEALS } from "../constants";
import { id, lookup, tx } from "@instantdb/react";
import { enqueueSnackbar } from "notistack";
import { db } from "..";
import { Deal, Player, Round, Turn } from "../types";

export const GameComp = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const [addPlayerDialogOpen, setAddPlayerDialogOpen] = useState(false);

  const [isClosed, setIsClosed] = useState(false);

  if (!gameId) {
    throw Error("No game id");
  }
  const query = {
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
          id: gameId,
        },
      },
    },
  };

  const { isLoading, error, data } = db.useQuery(query);
  console.log({ isLoading, error, data, gameId });

  if (!gameId) {
    console.error("No gameId");
    enqueueSnackbar("No gameId", { variant: "error" });
    return null;
  }

  const removePlayer = async (playerId: string) => {
    const res = await db.transact([tx.playersOrders[id()].delete()]);
    if (res.status === "enqueued") {
      enqueueSnackbar("Player removed", { variant: "success" });
    }
  };
  if (!data) {
    return <div>Loading...</div>;
  }

  const game = data.games[0];
  console.log({ game });
  const rs = game.rounds.sort((a, b) => a.roundNumber - b.roundNumber);
  console.log({ rs });

  const numPlayers = Object.values(game?.playersOrders ?? {}).length;
  const lastRound =
    rs.find(
      (r) =>
        r.turns.length !== numPlayers ||
        r.turns.some((t) => t.score === undefined)
    ) ?? rs[0];
  const currentRoundIdx = lastRound.roundNumber;

  const currentRound = (
    rs?.length ? rs[currentRoundIdx] ?? null : null
  ) as Round | null;
  console.log({ currentRound });

  const dealerIdx = getDealerIdx(currentRoundIdx, numPlayers);
  console.log({ dealerIdx });

  const players: Player[] = Object.values(game.playersOrders)
    .sort((apo, bpo) => apo.orderNumber - bpo.orderNumber)
    .flatMap((p) => p.player as Player);
  console.log({ players });
  const currentPlayerId = getCurrentPlayerIdFromRound(
    currentRound,
    dealerIdx,
    players
  );
  console.log({ currentPlayerId });

  const numTurns = currentRound ? currentRound.turns.length : 0;
  console.log({ numTurns });
  const stage: "bid" | "score" = numTurns === players.length ? "score" : "bid";
  console.log({ stage });

  const getScoreForPlayer = (playerId: string) => {
    return rs?.length
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
        (t) => t.bid === undefined && t.score === undefined
      )
    ) {
      round_idx -= 1;
      round_to_undo = rs?.[round_idx];
    }

    // back to the start
    if (!round_to_undo) {
      return;
    }

    // work out who's turn it is, 0th player changes each round
    const dealerIdx = getDealerIdx(round_idx, players.length);
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
    console.log({ playerToUndo });
    console.log(
      round_to_undo.turns.find((p) => p.player[0].id === playerToUndo.id)?.id
    );
    if (
      round_to_undo.turns.find((p) => p.player[0].id === playerToUndo.id)
        ?.score !== undefined
    ) {
      // round_to_undo.turns.find((p) => p.id === playerToUndo.id)!.score =
      //   undefined;

      const res = await db.transact([
        tx.turns[
          round_to_undo.turns.find((p) => p.player[0].id === playerToUndo.id)!
            .id
        ].merge({
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
    // round_to_undo[playerToUndo].bid = undefined;
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
      {(numPlayers < 2 || addPlayerDialogOpen) && (
        <AddPlayerDialog onClose={() => setAddPlayerDialogOpen(false)} />
      )}
      {currentRoundIdx === null && !isClosed && (
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
      <div className="flex justify-end space-x-2 px-1 my-1">
        <button
          className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900"
          onClick={() => setAddPlayerDialogOpen(true)}
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
          <PlayerComp player={p} key={p.id} isDealer={idx === dealerIdx} />
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
                    {
                      rs?.[t_idx].turns.find((t) => t.player[0].id === p.id)
                        ?.bid
                    }
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
                      rs?.[t_idx].turns.find((t) => t.player[0].id === p.id)
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

const AddPlayerDialog = ({ onClose }: { onClose: () => void }) => {
  const { gameId } = useParams();
  const [type, settype] = useState<"existing" | "new">("existing");
  const [playerName, setPlayerName] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const {
    data: allPlayers,
    isLoading,
    error,
  } = db.useQuery({
    players: {},
  });
  const {
    data: playersInGame,
    isLoading: isLoading2,
    error: error2,
  } = db.useQuery({
    players: {
      $: {
        where: {
          "playersOrders.game.id": gameId!,
        },
      },
    },
  });
  console.log({ allPlayers });
  console.log({ playersInGame });
  const psInGame = playersInGame?.players.map((p) => p.id);
  console.log("playerids in game", psInGame);

  const addExistingPlayerToGame = async (
    playerId: string,
    orderNumber: number
  ) => {
    const res = await db.transact([
      tx.playersOrders[id()]
        .update({ orderNumber })
        .link({ player: playerId, game: gameId! }),
    ]);
    if (res.status === "enqueued") {
      enqueueSnackbar("Player enqueued (linked)", { variant: "success" });
    }
  };

  const addNewPlayerToGame = async (name: string, orderNumber: number) => {
    const playerId = id();
    const res = await db.transact([
      tx.players[playerId].update({ name }),
      tx.playersOrders[id()]
        .update({ orderNumber })
        .link({ player: playerId, game: gameId! }),
    ]);
    if (res.status === "enqueued") {
      enqueueSnackbar("Player enqueued", { variant: "success" });
    }
  };

  const handleAddPlayer = () => {
    if (type === "new") {
      console.log("Add new player", playerName);
      if (!playerName.length) {
        enqueueSnackbar("Name is required", { variant: "error" });
        return;
      }

      const res = addNewPlayerToGame(playerName, psInGame?.length ?? 0);
      setPlayerName("");
      return;
    }
    if (!selectedPlayer) {
      enqueueSnackbar("Player is required", { variant: "error" });
      return;
    }
    const res = addExistingPlayerToGame(
      selectedPlayer.id,
      psInGame?.length ?? 0
    );
    setSelectedPlayer(null);
  };
  return (
    <Modal component={"div"} open onClose={onClose}>
      <ModalDialog>
        <DialogTitle>Add player</DialogTitle>
        <DialogContent>
          <RadioGroup
            value={type}
            onChange={(e) => settype(e.target.value as any)}
          >
            <Radio id={"false"} value={"existing"} label="Existing Player" />
            <Radio id={"true"} value={"new"} label="New Player" />
          </RadioGroup>

          {type === "new" ? (
            <Input
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
            />
          ) : (
            <Autocomplete<Player>
              value={selectedPlayer}
              onChange={(e, val) => setSelectedPlayer(val)}
              isOptionEqualToValue={(o, v) => o.id === v?.id}
              options={
                allPlayers?.players
                  .filter((p) => !psInGame?.includes(p.id))
                  .map(
                    (p) =>
                      ({
                        id: p.id,
                        name: p.name as any,
                      } as Player)
                  ) ?? []
              }
              getOptionLabel={(o) => o.name}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleAddPlayer}>Add player</Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
};

const getDealerIdx = (roundIdx: number | null, numPlayers: number) => {
  return roundIdx !== null ? (roundIdx + numPlayers - 1) % numPlayers : null;
};

const PlayerComp = ({
  player,
  isDealer,
}: {
  player: Player;
  isDealer: boolean;
}) => {
  const id = player.id;
  const { gameId } = useParams();
  const [temp_name, changeTempName] = useState("");
  const [changing_name, setChangingName] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (player) {
      changeTempName(player.name);
    }
  }, [player, setChangingName]);

  const handleSave = () => {
    console.log("Impl");
  };
  // const handleChangePlayer = async (e) => {
  //   await set(ref(db, "/players/" + gameId + "/" + id), { name: temp_name });

  //   setChangingName(false);
  // };

  return (
    <div className={`${isDealer ? "bg-red-500" : ""} text-center text-xs`}>
      {changing_name ? (
        <Modal open onClose={() => setChangingName(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
          >
            <ModalDialog>
              <DialogTitle>Player settings</DialogTitle>
              <FormControl>
                <FormLabel>Name</FormLabel>
                <Input
                  required
                  value={temp_name}
                  onChange={(e) => changeTempName(e.target.value)}
                />
              </FormControl>
              <Button variant="soft" onClick={() => setChangingName(false)}>
                Cancel
              </Button>
              <Button color="danger" variant="soft">
                Delete player
              </Button>
              <Button type="submit">Save</Button>
            </ModalDialog>
          </form>
        </Modal>
      ) : (
        <button
          // onFocus={() => setChangingName(true)}
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
  players: Player[],
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

  console.log(players);
  const bids_left = currentRound
    ? players.length - currentRound.turns.length
    : players.length;
  console.log({ bids_left });

  const options = all_options.filter((o) => o.number <= turn.num_cards);
  if (stage === "score") {
    return options;
  }
  if (bids_left !== 1) {
    return options;
  }
  console.log({ options });

  const sum_bids = currentRound
    ? currentRound.turns.reduce((acc, turn) => {
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
  ps: Player[]
): string | null => {
  if (dealerIdx === null) {
    return ps[0].id;
  }
  const startingPlayerIdx = (dealerIdx + 1) % ps.length;

  const orderedPlayers = [
    ...ps.slice(startingPlayerIdx),
    ...ps.slice(0, startingPlayerIdx),
  ];

  if (!round) {
    return orderedPlayers[0].id;
  }

  const playerId =
    orderedPlayers.find(
      (p) =>
        (round.turns.find((t) => t.player[0].id === p.id) as Turn | undefined)
          ?.bid === undefined
    ) ??
    orderedPlayers.find(
      (p) =>
        (round.turns.find((t) => t.player[0].id === p.id) as Turn | undefined)
          ?.score === undefined
    ) ??
    null ??
    null;

  return playerId?.id ?? null;
};
