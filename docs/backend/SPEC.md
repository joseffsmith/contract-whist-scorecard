# Own backend: spec

We're replacing InstantDB (its cloud service shuts down 31 Aug 2027) with our
own small backend. Contracts live in `shared/types.ts`; this doc gives the
rules. Branch: `own-backend`.

## Non-negotiables

- **Offline first.** Anyone who has opened the app before can deal, bid,
  score, add players and reload with no signal. Writes queue and sync later.
- **Live.** Every phone watching a game sees bids/scores within ~1s online.
- **No new runtime dependencies** unless agreed. Server uses Node 22
  built-ins (`node:http`, `node:sqlite`, `node:crypto`); agreed exceptions:
  `@simplewebauthn/server` (passkeys, bundled by esbuild) and
  `@simplewebauthn/browser` (client). Dev deps available:
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
  `/contract-whist/api/*` → `/*`. Real client IP = the `TRUST_PROXY_HOPS`-th
  entry from the end of `X-Forwarded-For` (default 1 = last; 0 = socket
  address). IPv6 clients are rate limited by /64.
- Daily `VACUUM INTO` backups in `${DATA_DIR}/backups` (`BACKUP_DAYS`,
  default 14, 0 = off). See CUTOVER.md.
- JSON in/out, `cache-control: no-store`. Errors: `{ error, code }`.

### Auth

- Sessions: random 32-byte base64url token, stored as sha256 hash,
  `Authorization: Bearer <token>`. No expiry needed.
- Passwords: scrypt (N=32768, r=8, p=1, 64-byte key, 16-byte salt);
  timing-safe compare; dummy hash for unknown emails; rate limits per IP and
  per email.
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
  `internal.allowClaimedFrom = guestUserId`. Only one guest player is handed
  over (most seats, then smallest id); a player that can't move is released,
  as are any others. Games the guest hosted move to the account
  (`createdBy`) in the same version. The guest's sessions end. Failures here
  must not fail the login. A user without a password can't log in (same generic
  `bad_credentials` error).
- `POST /auth/logout` (a guest's claimed players are released first),
  `GET /auth/me` → `{ user }`. `PublicUser.isAdmin` is set for admins.
  `PublicUser.hasPassword` is true when the account can log in with email and
  password (it has both); `passkeyCount` is how many passkeys it has.
- `POST /auth/password {password}` (signed-in, non-guest, with an email) →
  set/change; an account without an email gets 400 `no_email`.
- `POST /auth/email {email, password}` (signed-in, non-guest, **no email
  yet**, i.e. a passkey-only account) → `AuthResponse` (same session). Sets
  both as a backup sign-in. Same validation as signup; 409 `has_account` for
  a taken email, 409 `has_email` if it already has one; its own rate limit;
  the session is checked again after hashing.
- `POST /auth/sessions/revoke-others` (signed in) → `{ ok }`: deletes every
  session of the user except the one making the request.
- **Passkeys** (WebAuthn, `@simplewebauthn/server`). Table `passkeys(id =
  credential id base64url, user_id, public_key, counter, transports,
  device_type, backed_up, name, created_at, last_used_at)`. Credentials are
  discoverable (`residentKey: "required"`) and need user verification
  (`userVerification: "required"`, enforced when verifying), so signing in
  needs no username. RP name "Whist". Config: `PASSKEY_RP_ID` (default: host
  of `PUBLIC_URL`) and `PASSKEY_ORIGINS` (comma list; default: origin of
  `PUBLIC_URL`); the browser's reported origin and RP ID must match. At
  startup the RP ID (lower-cased) must be a bare host name, not an IP
  address, that every origin's host equals or is a subdomain of, else the server refuses to start. The authenticator's user
  handle is a random 32-byte `users.webauthn_user_id`, made on first use
  (never the user id), and checked on sign-in. A user has at most 20 passkeys.
  - Challenges are **stateless**: the `challengeId` is an HMAC-SHA256-signed
    token over `{challenge (32 random bytes), kind, userId or null,
    newAccount?: {id, handle}, expires}` (5-minute expiry). The key is made
    once and kept in `settings('challenge_secret')`, so tokens survive
    restarts (and a token from another database is refused). Only tokens
    already used are remembered, in memory, until they would have expired;
    verify is rate limited, so that set stays small. A token is single-use
    (spent even by a failed attempt) and bound to its kind and its user. Every
    `…/options` answer is `{ challengeId, options }` and the client sends
    `challengeId` back with the browser's response. A tampered, spent, expired
    or mismatched token → 400 `challenge_expired`.
  - `POST /auth/passkey/register/options`. **Signed in** (guest or account):
    options for that user; `user.name`/`displayName` = the email, else the
    name of the user's claimed player, else "Whist player";
    `excludeCredentials` = the user's passkeys. **No session**: options for a
    brand-new account ("create account" mode): a server-made user id and
    random user handle go into the signed token, and nothing is stored until
    verify. A session that is sent but no longer exists → 401.
  - `POST /auth/passkey/register/verify {challengeId, response, name?}` →
    `AuthResponse`. With a session: a guest is upgraded in place exactly as
    signup does it (`is_guest = 0`, id kept so claims stay, email stays null,
    no password, guest token retired and a new session returned); an account
    keeps its session. The request's own session must still exist when the
    passkey is stored (checked in the same transaction), else 401
    `not_signed_in`: a sign-out, a password change or another tab upgrading
    the same guest in the meantime wins (that second tab is told to sign in
    again, never handed the retired guest token). Without a session, for a
    "create account" token: makes the user (email null, no password, the
    handle from the token) with the passkey and a session, in one
    transaction. A token made for a session can't make an account and the
    reverse. Sessions made here (the guest upgrade, the new account) record
    the new passkey in `sessions.passkey_id`. A credential id that already
    exists (anyone's) → 409 `passkey_exists`. Bad attestation → 400
    `passkey_failed`.
  - `POST /auth/passkey/login/options` (no session; empty `allowCredentials`)
    and `POST /auth/passkey/login/verify {challengeId, response, guestToken?}`
    → `AuthResponse`. The credential is looked up by id, verified (signature,
    origin, RP ID, counter) and its counter, `backed_up` and `last_used_at`
    updated. `guestToken` does the same guest → account handoff as password
    login (same code). Unknown credential or deleted user → 401
    `unknown_passkey` "That passkey isn't recognised."; failed verification
    (including a counter that went backwards) → 401 `passkey_failed`.
  - Sessions made by passkey login record `sessions.passkey_id`; removing
    that passkey deletes them. An admin password reset also deletes the
    account's passkeys, like it deletes its sessions.
  - `GET /auth/passkeys` → `{ passkeys: [{ id, name, createdAt, lastUsedAt,
    deviceType, backedUp }] }` (never the key). `DELETE /auth/passkeys/:id`
    removes one of the caller's; 409 `last_sign_in` if the account would be
    left with no way in (no email+password, no Apple ID and no other passkey).
  - Rate limits per IP: options 300 (they are cheap, and prepared ahead) and
    verify 30 per 15 minutes.
  - The apps' passkeys: on iOS they report the site's origin, so nothing
    changes. On Android they report `android:apk-key-hash:<base64url SHA-256
    of the signing certificate>`; each `ANDROID_CERT_SHA256` fingerprint adds
    one such origin.
- **Sign in with Apple** (`server/src/apple.ts`). Table `identities(provider,
  subject, user_id, email, created_at, last_used_at)`, primary key (provider,
  subject); provider `apple`, subject Apple's `sub`. The email Apple gives is
  kept for reference only: it never becomes `users.email`, so it can't sign in
  or clash with an email account. `PublicUser.hasApple` is set when linked.
  - `POST /auth/apple/options` (session optional) → `{challengeId, nonce}`:
    a challenge token of kind `apple`, bound to the session's user if any. The
    app puts `nonce` in its Apple request unchanged.
  - `POST /auth/apple/verify {challengeId, identityToken, guestToken?}`. The
    token (RS256 JWT) must be signed by one of Apple's keys
    (`appleid.apple.com/auth/keys`, cached for a day; an unknown key id
    refetches at most once a minute), `iss` Apple, `aud` the bundle id (or an
    `APPLE_SERVICES_IDS` entry), unexpired (60 s skew) and carry the nonce;
    else 401 `apple_failed`. Then: **Apple ID known** → signed out: a new
    session for its account (a `guestToken` hands that guest's player over,
    as with login); the same account: unchanged session; a guest: signs in to
    the Apple ID's account with the guest's player handed over; another
    account: 409 `apple_taken`. **Unknown** → signed out: a new account (no
    email or password) with the Apple ID; a guest: upgraded in place (same id,
    new session, guest sessions retired); an account: linked, same session,
    unless it already has an Apple ID (409 `has_apple`).
  - Deleting the account or an admin password reset removes its identities.
  - Not done yet: revoking Apple's tokens when an account is deleted (App
    Store guideline 5.1.1(v) asks for it). It needs a Sign in with Apple key
    and the authorization code exchanged at sign-in.
  - Rate limits per IP: options 300, verify 30 per 15 minutes.
- **App association files**: `GET /.well-known/apple-app-site-association`
  (with `APPLE_TEAM_ID`: `webcredentials` and `applinks` for
  `<TEAM>.<bundle id>`; links under `join/`, `games/` (not `games/guest/`),
  `stats/`, `leaderboard` and `players` open the app) and
  `GET /.well-known/assetlinks.json` (with `ANDROID_CERT_SHA256`:
  `handle_all_urls` and `get_login_creds`). 404 when not configured.
- **Delete account**: `DELETE /auth/me {confirm: "DELETE"}` (signed in; guests
  too). In one go: the user's claimed players are released through the same
  `unclaimPlayer` action as a guest logout (so it syncs); sessions, passkeys,
  Apple IDs and reset links are deleted; email, password, guest secret and
  `webauthn_user_id` are cleared, `is_admin` is dropped and `deleted_at` set.
  The `users` row stays as a **tombstone**: `POST /auth/guest {id}` for it
  answers 409 `id_taken`, like any reserved id. Games, scores and players stay
  (others played in them). A deleted user is treated as non-existent by every
  auth path: session lookup, email login, passkey login, reset links, signup
  upgrade. The email can be used for a new, empty account. 10 per IP per 15
  minutes. If the only admin deletes themselves the role is gone, so
  `ADMIN_BOOTSTRAP_TOKEN`, if still set, works again.
- No email sending (no external services). Forgotten passwords: an admin
  creates a set-password link and shares it by hand.
- Admin: `users.is_admin`. The first admin is made with the secret env
  `ADMIN_BOOTSTRAP_TOKEN`: a signed-in non-guest user opens
  `${PUBLIC_URL}/admin#<token>` and `POST /auth/claim-admin {token}` sets
  `is_admin` (timing-safe compare; once any admin exists it answers 403).
  Admins pass every creator check in `applyAction` (`ctx.isAdmin`) and can:
  `POST /auth/reset-link {email}` → `{ url }` (one-time, 7 days,
  `${PUBLIC_URL}/reset#<token>`; `PUBLIC_URL` default
  `https://joseffsmith.uk/contract-whist`). `POST /auth/reset {token,
  password}` → `AuthResponse`; it ends all the user's sessions and retires
  their other links.

### Sync

- `GET /sync/pull?since=V` → `ChangeSet` (rows with `version > V`; `since=0`
  or a too-old V → full snapshot with `reset: true`).
- `GET /sync/stream?since=V` → `text/event-stream`. First event: changes
  since V. Then one `data:` event (JSON `ChangeSet`) per applied action,
  heartbeat comment every 20s. Works without auth (read-only).
- `POST /sync/push` `PushRequest` → `PushResponse`. Needs a session. Apply
  each action in its own transaction, in order; already-applied ids → ok.
- `GET /health` → `{ ok: true, version }`.

### Migration from InstantDB

- `server/scripts/export-instant.mjs`: dumps players/games/playersOrders/
  rounds/turns (with link ids) to a JSON file. The InstantDB app is publicly
  readable, so no admin token is needed: it runs the `@instantdb/core` query
  in headless Chromium (Playwright and Chromium are installed separately).
- `POST /admin/import` (only when `IMPORT_TOKEN` is set; header
  `x-import-token`; body up to 20 MB): transforms that JSON
  (`server/src/importInstant.ts`) and loads it into a database with no synced
  rows, keeping ids (`importSnapshot`). `playersOrders` → `seats`. **No users
  are imported** and every player's `claimedBy` is cleared: after cutover
  everyone creates an account (or joins as a guest) and claims their player
  again. Rows that don't hang together are skipped and counted in the
  response.

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
- Passkeys: `registerPasskey(name?)` (upgrades a guest, like `signUp`),
  `logInWithPasskey()` (pushes the guest's queued work, then sends the guest
  token, like `logIn`), `listPasskeys()`, `deletePasskey(id)` and
  `deleteAccount()` (signs out locally and drops unsent changes). The first
  two resolve `null` when the person dismisses the browser prompt
  (`NotAllowedError`/`AbortError`): the UI treats that as a quiet no-op,
  unless the refusal came back within `quickDismissMs` (300) of opening it,
  which is the browser refusing, not the person (Safari does this when the
  call isn't close enough to the tap): that is a `prompt_failed` error. To
  keep the call close to the tap, `preparePasskey("login" | "register")`
  fetches the options (and loads the browser library) beforehand, and the
  tap uses them with no network wait before the prompt; the guest push and
  handoff, and `ensureReal`, come after it. `usePreparedPasskeys` refreshes
  them when older than 4 minutes, on `visibilitychange` (to visible) and when
  a session appears. The login page makes no guest. `registerPasskey` upgrades a signed-in
  account, or a guest with something to keep (a claimed player, games or
  queued work), in place; anyone else (signed out, or an empty guest) makes a
  new account, and the post-login flow is signup's ("Which player is you?").
  `preparePasskey("register")` prepares whichever of the two applies. Nothing
  is prepared while `document.hidden`, and only for the pages that show the
  prompts (the signed-out login page: sign-in plus new-account options; the
  passkeys card). If the server refuses a passkey the device already made
  (401, or the session changed), the client calls
  `PublicKeyCredential.signalUnknownCredential` where supported so the
  device drops it. `addEmail(email, password)` and
  `signOutOthers()` call the two routes above. They
  go through `SyncDeps.passkeys` (`@simplewebauthn/browser`, loaded on first
  use) so tests can stub the prompt. The UI only offers passkeys when
  `window.PublicKeyCredential` exists (`passkeysSupported()`).
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

## Cutover notice

`src/components/chrome/AccountMovedBanner.tsx` (with `src/lib/legacyAccount.ts`)
detects a leftover InstantDB sign-in in the browser and explains that logins
didn't carry over. Mount it at the top of Home and the You page with
`signedIn={!!user && !user.isGuest}`. Its "Create account" link opens
`/login?mode=signup&next=/user` — the login screen should open on the
"Create account" tab when `mode=signup`.

## Guest play syncs (no more phone-only games)

- "Play as guest" = an anonymous **server** guest (`sync.signInAsGuest()`),
  then "Which player is you?" — games are normal synced games.
- Offline first use: with no session and no network, the client creates a
  **provisional guest** locally (client-generated uuid user id, stored like a
  session but without a token). Actions queue under it as usual. When online,
  the client calls `POST /auth/guest { id }`; the server creates the guest with
  that id if unused (uuid v4 format; otherwise 409 `id_taken` → client falls
  back to a fresh guest and re-queues; actions whose args embed the old id,
  e.g. importGame.createdBy, are rewritten). Then pushes as normal.
- The old local guest mode (src/guest, localStorage) is kept only to view and
  finish games already stored on a phone. Any signed-in phone (guest or
  account) with local guest games sees "N game(s) saved only on this phone —
  Save them so everyone can see them", opening GuestMigrationDialog
  (importGame). New local-only games can no longer be started.

