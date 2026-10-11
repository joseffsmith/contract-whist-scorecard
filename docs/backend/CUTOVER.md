# Cutover: InstantDB → own backend

Canonical address after cutover: **https://joseffsmith.uk/contract-whist**
(host nginx proxies it straight to the Coolify app on port 3018, so it's the
same origin people already use — old logins are detectable for the "we've
moved" banner, and installed home-screen apps keep working).
`https://whist.joseffsmith.uk` serves the same app.

## Before

- All own-backend fixes merged and green (`npm test`, both typechecks, both
  builds). Browser end-to-end run against the real export.
- Pick a quiet time with no game in progress.

## Steps

| # | Who | Step | Check |
|---|---|---|---|
| 1 | Joe | InstantDB dashboard → app `contract-whist-scoreboard` → **Permissions** → replace with the read-only rules below → Save. Freezes the old app so nothing written after the export is lost. | Old site can't add a bid. |
| 2 | Claude | Export InstantDB (`server/scripts/export-instant.mjs`). | Counts match the old leaderboard; dry-run import shows 0 skipped and identical per-player totals. |
| 3 | Claude | Coolify (whist app): set `PUBLIC_URL=https://joseffsmith.uk/contract-whist`, `ADMIN_BOOTSTRAP_TOKEN=<random>`, `IMPORT_TOKEN=<random>`; volume `/data` (exists). Merge `own-backend` → `main`, deploy. | `/contract-whist/api/health` → `{"ok":true,"version":0}`. |
| 4 | Claude | `POST /contract-whist/api/admin/import` with the export and `x-import-token`. Remove `IMPORT_TOKEN`, redeploy. | Response counts = export counts, nothing skipped; health `version: 1`; leaderboard identical to the old one. |
| 5 | Claude (approval prompt) | Host nginx: point `joseffsmith.uk` `/contract-whist/` at `http://127.0.0.1:3018` (one-off root container as for whist.joseffsmith.uk; `nginx -t` before reload). | Container log's last `X-Forwarded-For` entry is the phone's real IP; live stream pings within 20s. |
| 6 | Joe | Open `https://joseffsmith.uk/contract-whist/admin#<token>` → create account → **Make me the admin**. Claude then removes `ADMIN_BOOTSTRAP_TOKEN`. | You page shows admin tools; a reset link opens on joseffsmith.uk. |
| 7 | Everyone | Open the app **twice** with signal (first open may still be the old cached version), see the banner, create an account (or join as guest), tap your name. | Two phones see a bid within ~1s; airplane-mode deal/bid/reload/reconnect syncs. |
| 8 | Claude | Backups of `/data` (see below). Keep InstantDB read-only for a few weeks. | |

### InstantDB read-only rules (step 1)

```json
{
  "attrs": { "allow": { "create": "false" } },
  "$users": { "allow": { "view": "auth.id == data.id", "create": "false", "update": "false", "delete": "false" } },
  "players": { "allow": { "view": "true", "create": "false", "update": "false", "delete": "false" } },
  "games": { "allow": { "view": "true", "create": "false", "update": "false", "delete": "false" } },
  "playersOrders": { "allow": { "view": "true", "create": "false", "update": "false", "delete": "false" } },
  "rounds": { "allow": { "view": "true", "create": "false", "update": "false", "delete": "false" } },
  "turns": { "allow": { "view": "true", "create": "false", "update": "false", "delete": "false" } }
}
```

### Rollback

InstantDB data is untouched (only frozen). To roll back: restore the host
nginx `joseffsmith.uk` config (the step-5 script keeps a timestamped copy),
paste back the previous InstantDB permissions (`{}` / the old rules), and
redeploy the previous `main` commit in Coolify.

### Backups

`/data/whist.db` (SQLite, WAL). On startup and then every 24h the server
writes `/data/backups/whist-YYYY-MM-DD.db` (`VACUUM INTO`, mode 0600, skipped
if today's exists) and keeps the newest `BACKUP_DAYS` (default 14; `0`
disables). A failure is logged, never fatal. The copies share the volume with
the live database, so also copy them off the box until something does that
automatically.
