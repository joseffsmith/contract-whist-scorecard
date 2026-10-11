# Own backend: spec

We're replacing InstantDB (its cloud service shuts down 31 Aug 2027) with our
own small backend. Contracts live in `shared/types.ts`; this doc gives the
rules. Branch: `own-backend`.

## Non-negotiables

- **Offline first.** Anyone who has opened the app before can deal, bid,
  score, add players and reload with no signal. Writes queue and sync later.
- **Live.** Every phone watching a game sees bids/scores within ~1s online.
- **No new runtime dependencies** unless agreed. Server uses Node 22
  built-ins (`node:http`, `node:sqlite`, `node:crypto`). Dev deps available:
  vitest, fake-indexeddb, @types/node, esbuild (via vite), typescript.
- Small, readable code that matches the repo's style (see `src/`).

## Architecture

```
phone (React) ── src/sync ──(fetch + SSE)── nginx /contract-whist/api/ ── server (Node, SQLite on /data)
        └─ shared/actions.ts runs here (optimistic)        shared/actions.ts runs here (authoritative) ─┘
```

1. UI calls `dispatch(name, args)`. The client runs `applyAction` against its
   current view, applies the resulting row ops locally, stores the action in
   a persistent **pending queue** (IndexedDB), and pushes when online.
2. Server runs the *same* `applyAction` against SQLite inside a transaction,
   bumps a global `version`, records the action id (idempotency), and
   broadcasts a `ChangeSet` to all connected streams.
3. Client view = server snapshot (rows at version V) + pending actions
   re-applied in order. On every incoming ChangeSet the snapshot advances
   and pending actions are re-applied (rebase). An action leaves the queue
   when the server acks it (ok or rejected). A rejected action is dropped
   and reported to the UI.

## Data

Synced tables: `players`, `games`, `seats` (old `playersOrders`), `rounds`,
`turns` — see `shared/types.ts`. Everyone (even signed-out visitors) can
read all synced rows, as today. `users`/`sessions` are server-only.

DEALS (num cards per roundNumber 0..12): `[7,6,5,4,3,2,1,2,3,4,5,6,7]`.

## Actions (`shared/actions.ts`)

`applyAction(state: ReadState, action, ctx): RowOp[]` — pure, deterministic,
throws `ActionError(message, code)` when invalid. All writes need
`ctx.userId`. "Creator" = `game.createdBy === ctx.userId`. A game is
"started" when any of its rounds has a turn. Ignore deleted games' rows only
where stated. Messages are user-facing (short, plain English).

| Action | Who | Rules / effect |
|---|---|---|
| createPlayer | any user | name trimmed, 1–40 chars. `claim` → `claimedBy = ctx.userId`. `createdAt = now`. |
| claimPlayer | any user | player exists, not merged, `claimedBy` empty or already self. Sets `claimedBy`. |
| unclaimPlayer | owner | `claimedBy === ctx.userId`; clears it. |
| createGame | any user | `roundIds` = 13 unique ids. Player exists, not merged. Puts game (`createdAt=now`, `createdBy=ctx.userId`), rounds 0..12, seat order 0. |
| deleteGame | creator | sets `deletedAt = now`. |
| addSeat | creator, **or** a user seating a player they've claimed in a game that hasn't started | game not deleted; player exists, not merged, not already seated in this game. |
| removeSeat | creator | reject if that player has turns in this game. |
| reorderSeats | creator | `seatIds` must be exactly the game's seats; puts `orderNumber = index`. |
| setInitialDealer | creator | not started; player seated. |
| placeBid | creator | round exists, game not deleted, player seated; integer `0..numCards`; no other turn for (round, player) (same turnId already present = no-op). |
| setScore | creator | turn exists with a bid; integer `0..30`. |
| clearScore | creator | sets score null. |
| deleteTurn | creator | deletes turn. |
| mergePlayers | user who owns `into` (`into.claimedBy === ctx.userId`) **or** any non-guest user | both exist, not merged, different. `from` must be unclaimed, unless `from.claimedBy === ctx.internal?.allowClaimedFrom`. Reject if they share a non-deleted game. Move all `from` seats and turns to `into`; games with `initialDealerId === from` → `into`; set `from.mergedInto/mergedAt/mergeLog`. |
| undoMerge | non-guest user, or owner of the player it was merged into. If `from.claimedBy` is set (e.g. a guest→account handoff), only the owner of the merge target | `from.mergeLog` present. Only move logged rows whose current holder is on the merge chain starting at `mergeLog.into` (into, its mergedInto, …): seats, plus every turn that holder has in each restored seat's game; dealer only where the current dealer is on that chain. Clear merge fields. |
| importGame | any user | `game.createdBy === ctx.userId`, game id unused; create `newPlayers`; all seats/rounds/turns reference this game/its rounds and existing-or-new players. |

Replaying an action against the state it already produced must be a no-op
(return `[]`), never an error — the client re-applies pending actions on
every rebase. Ops must not depend on row iteration order (sort ids).

## Server (`server/src/`, TypeScript, bundled by esbuild to `server/dist/index.mjs`)

- `node:sqlite` DB at `${DATA_DIR}/whist.db` (`DATA_DIR` default `/data`).
  One table per synced table with the row fields as columns (JSON column for
  `mergeLog`), plus `version INTEGER` and `deleted INTEGER` (tombstones, so
  pulls can return deletes). `meta(key, value)` holds the global version.
  `applied_actions(id PRIMARY KEY, user_id, version, at)` for idempotency.
- Listens on `127.0.0.1:${PORT}` (default 3001); nginx proxies
  `/contract-whist/api/*` → `/*`. Real client IP = last entry of
  `X-Forwarded-For`.
- JSON in/out, `cache-control: no-store`. Errors: `{ error, code }`.

### Auth

- Sessions: random 32-byte base64url token, stored as sha256 hash,
  `Authorization: Bearer <token>`. No expiry needed.
- Passwords: scrypt as in the current `server/auth.mjs` (N=32768, r=8, p=1,
  64-byte key, 16-byte salt); timing-safe compare; dummy hash for unknown
  emails; rate limits as there.
- `POST /auth/guest` → `AuthResponse` (new guest user).
- `POST /auth/signup {email, password}` → `AuthResponse`. No email
  verification. If the request carries a **guest** session, upgrade that
  same user in place (keep id; set email/password; `isGuest=false`).
  Email already registered → 409 `has_account` ("That email already has an
  account. Log in instead.").
- `POST /auth/login {email, password, guestToken?}` → `AuthResponse`. If
  `guestToken` belongs to a guest who claimed a player: if the account has
  no active claimed player, transfer the claim; otherwise run
  `mergePlayers(guestPlayer → accountPlayer)` with
  `internal.allowClaimedFrom = guestUserId`. Failures here must not fail the
  login. A user without a password can't log in (same generic
  `bad_credentials` error).
- `POST /auth/logout`, `GET /auth/me` → `{ user }`.
- `POST /auth/password {password}` (signed-in, non-guest) → set/change.
- No email sending (no external services). Forgotten passwords: an admin
  creates a set-password link and shares it by hand.
- Admin (session email in `ADMIN_EMAILS`, comma-separated env):
  `POST /auth/reset-link {email}` → `{ url }` (one-time, 7 days,
  `${PUBLIC_URL}/reset/<token>`, `PUBLIC_URL` default
  `https://whist.joseffsmith.uk/contract-whist`). `POST /auth/reset
  {token, password}` → `AuthResponse`.

### Sync

- `GET /sync/pull?since=V` → `ChangeSet` (rows with `version > V`; `since=0`
  or a too-old V → full snapshot with `reset: true`).
- `GET /sync/stream?since=V` → `text/event-stream`. First event: changes
  since V. Then one `data:` event (JSON `ChangeSet`) per applied action,
  heartbeat comment every 20s. Works without auth (read-only).
- `POST /sync/push` `PushRequest` → `PushResponse`. Needs a session. Apply
  each action in its own transaction, in order; already-applied ids → ok.
- `GET /health` → `{ ok: true, version }`.

### Migration from InstantDB (`server/scripts/`)

- `export-instant`: dump all players/games/playersOrders/rounds/turns
  (with link ids) to a JSON file. The InstantDB app is publicly readable, so
  no admin token is needed: run the `@instantdb/core` client query in a
  headless browser (as the orchestrator did for the duplicates audit) or
  via the public HTTP API.
- `import-instant`: load that JSON into an **empty** DB, keeping ids.
  `playersOrders` → `seats`. **No users are imported** and every player's
  `claimedBy` is cleared: after cutover everyone creates an account (or
  joins as a guest) and claims their player again.

## Client (`src/sync/`)

- `sync` singleton: hydrates from IndexedDB (`whist-sync`: snapshot rows,
  version, pending actions, session) before first render; then pulls and
  opens the stream; reconnects with backoff (1s → 30s) and on `online`.
- `dispatch(name, args): Promise<void>` — resolves once applied locally
  (rejects with ActionError if invalid locally). Generates action id.
- `onActionRejected(cb)` — server rejected a queued action (for a toast).
- Hooks (`src/sync/react.ts`): `useSyncView()` (derived DataState +
  `isLoading`), `useAuth()` → `{ isLoading, user: PublicUser | null }`,
  `useConnectionStatus()` → `"connected" | "connecting" | "offline"`.
- Auth: `signInAsGuest()`, `signUp(email, pw)`, `logIn(email, pw)` (sends the
  current guest token as `guestToken`), `logOut()`, `setPassword(pw)`,
  `resetPassword(token, pw)`. Logging out keeps the synced data, clears the
  session and pending actions.
- Selectors (`src/sync/selectors.ts`) returning the old query shapes so the
  UI changes little: `selectHomeGames(view)` →
  `{ games: (GameRow & { playersOrders: (SeatRow & { player?: PlayerRow })[];
  rounds: (RoundRow & { turns: (TurnRow & { player?: PlayerRow })[] })[] })[] }`.

## Testing

- `npm test` (vitest). Shared actions: unit tests per rule. Server:
  integration tests on a random port with a temp `DATA_DIR`. Client:
  engine tests with fake-indexeddb and a stubbed fetch/server.
- The orchestrator runs browser end-to-end tests (online, offline,
  multi-phone) before cutover.
