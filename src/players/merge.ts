import { db } from "../db";
import { online } from "../lib/offline";

// Merging moves every seat (playersOrders) and turn from one player to
// another and marks the old player as merged. What moved is recorded on the
// old player so the merge can be undone.

type MergeLog = {
  into: string;
  playersOrders: string[];
  turns: string[];
  dealerGames: string[];
};

const one = <T>(x: T | T[] | undefined | null): T | undefined =>
  Array.isArray(x) ? x[0] : x ?? undefined;

async function loadPlayer(playerId: string) {
  const { data } = await online(() =>
    db.queryOnce({
      players: {
        $: { where: { id: playerId } },
        playersOrders: { game: {} },
        turns: {},
      },
    })
  );
  const p = data.players[0];
  if (!p) throw new Error("Player not found");
  return p;
}

export class MergeError extends Error {}

export async function mergePlayers(
  fromId: string,
  intoId: string,
  opts: { allowClaimedFrom?: boolean } = {}
) {
  if (fromId === intoId) throw new MergeError("That's the same player");
  const [from, into] = await Promise.all([
    loadPlayer(fromId),
    loadPlayer(intoId),
  ]);
  if (from.mergedInto) throw new MergeError(`${from.name} is already merged`);
  if (into.mergedInto)
    throw new MergeError(`${into.name} has been merged away`);
  if (from.claimedBy && !opts.allowClaimedFrom) {
    throw new MergeError(
      `${from.name} is linked to someone's account, so it can only be merged by them`
    );
  }

  const intoGames = new Set(
    into.playersOrders.map((po) => one(po.game)?.id).filter(Boolean)
  );
  const clash = from.playersOrders.find((po) => {
    const g = one(po.game);
    return g && !g.deletedAt && intoGames.has(g.id);
  });
  if (clash) {
    throw new MergeError(
      `${from.name} and ${into.name} played in the same game, so they must be different people`
    );
  }

  const { data: dealerData } = await online(() =>
    db.queryOnce({
      games: { $: { where: { initialDealerId: fromId } } },
    })
  );

  const log: MergeLog = {
    into: intoId,
    playersOrders: from.playersOrders.map((po) => po.id),
    turns: from.turns.map((tt) => tt.id),
    dealerGames: dealerData.games.map((g) => g.id),
  };

  await db.transact([
    ...log.playersOrders.map((poId) =>
      db.tx.playersOrders[poId]
        .unlink({ player: fromId })
        .link({ player: intoId })
    ),
    ...log.turns.map((tid) =>
      db.tx.turns[tid].unlink({ player: fromId }).link({ player: intoId })
    ),
    ...log.dealerGames.map((gid) =>
      db.tx.games[gid].update({ initialDealerId: intoId })
    ),
    db.tx.players[fromId].update({
      mergedInto: intoId,
      mergedAt: new Date().toISOString(),
      mergeLog: log,
    }),
  ]);
}

export async function undoMerge(fromId: string) {
  const from = await loadPlayer(fromId);
  const log = from.mergeLog as MergeLog | undefined;
  if (!from.mergedInto || !log) throw new MergeError("Nothing to undo");
  // Seats/turns may have moved on again since (e.g. a later merge), so look
  // up who holds them now rather than assuming log.into.
  const { data } = await online(() =>
    db.queryOnce({
      playersOrders: {
        $: { where: { id: { in: log.playersOrders } } },
        player: {},
      },
      turns: { $: { where: { id: { in: log.turns } } }, player: {} },
    })
  );
  await db.transact([
    ...data.playersOrders.map((po) => {
      const holder = one(po.player)?.id;
      const tx = db.tx.playersOrders[po.id];
      return (holder ? tx.unlink({ player: holder }) : tx).link({
        player: fromId,
      });
    }),
    ...data.turns.map((tt) => {
      const holder = one(tt.player)?.id;
      const tx = db.tx.turns[tt.id];
      return (holder ? tx.unlink({ player: holder }) : tx).link({
        player: fromId,
      });
    }),
    ...log.dealerGames.map((gid) =>
      db.tx.games[gid].update({ initialDealerId: fromId })
    ),
    db.tx.players[fromId].update({
      mergedInto: null,
      mergedAt: null,
      mergeLog: null,
    }),
  ]);
}
