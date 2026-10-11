import { sync } from "../sync";

// Merging moves every seat and turn from one player to another and marks the
// old player as merged. What moved is recorded on the old player so the
// merge can be undone. The rules live in shared/actions.ts; these reject
// with an ActionError (user-facing message) when a merge isn't allowed. Both
// work offline like any other action.

export const mergePlayers = (fromId: string, intoId: string) =>
  sync.dispatch("mergePlayers", { fromId, intoId });

export const undoMerge = (fromId: string) =>
  sync.dispatch("undoMerge", { fromId });
