# Contract whist scorecard

Demo: https://joseffsmith.uk/contract-whist

## Stretch goals
- reorder players
- mix order of suits
- tell you who's turn it is to deal (over multiple games)

## Offline first

Anyone who has opened the app before must be able to use it with no signal.
The service worker serves the app shell; the sync engine (`src/sync`) keeps a
full local copy of the data in IndexedDB. Screens only read that copy
(`useSyncView` and the selectors) and every write is an action
(`sync.dispatch`, rules in `shared/actions.ts`) that is applied locally at
once and queued. The server (`server/`) is the authority: it runs the same
rules, rejects what isn't allowed (shown as a toast) and streams changes to
every phone. See `docs/backend/SPEC.md`.

Everything works offline except signing in as a guest, signing up, logging in
and joining a game that isn't on this phone yet. Those need the server and
say so.

Test offline with a production build (`npm run build && npm run serve`) and
Playwright's `context.setOffline(true)`.

## Deploying (Coolify)

The repo ships a `Dockerfile` that builds the app and the API server
(`server/src`, Node 22 with SQLite). One container runs nginx on port 80,
serving the app under `/contract-whist/` (`/` redirects there) and proxying
`/contract-whist/api/` to the server.

1. In Coolify: **+ New → Resource → Private repository (with GitHub App)**,
   pick `joseffsmith/contract-whist-scorecard`, branch `main`.
2. **Build pack:** Dockerfile. **Ports exposes:** `80`.
3. **Domain:** e.g. `https://whist.joseffsmith.uk`. Leave any "strip prefix"
   option off; the app expects the `/contract-whist/` path.
4. Keep **Auto deploy** on, so every push to `main` deploys.
5. **Storage:** add a persistent volume at `/data`. The SQLite database
   (all games, accounts and sessions) lives there, so back it up.
6. **Environment variables:**
   - `PUBLIC_URL`: the app's public URL, used in password reset links.
     Default `https://joseffsmith.uk/contract-whist`.
   - `PASSKEY_RP_ID`: the domain passkeys are tied to (the "relying party
     ID"). Default: the host of `PUBLIC_URL`, i.e. `joseffsmith.uk`. A
     passkey made for `joseffsmith.uk` also works on its subdomains, but not
     the other way round, and changing this later orphans every passkey. It
     must be a bare host name that every `PASSKEY_ORIGINS` host equals or sits
     under, or the server won't start.
   - `PASSKEY_ORIGINS`: comma-separated list of the page origins allowed to
     make or use passkeys. Default: the origin of `PUBLIC_URL`. For the live
     site: `https://joseffsmith.uk,https://whist.joseffsmith.uk`. For local
     development with `PUBLIC_URL=http://localhost:5173/contract-whist` the
     defaults are `localhost` and `http://localhost:5173`.
   - `ADMIN_BOOTSTRAP_TOKEN`: a long random secret. Sign up, then open
     `https://<your domain>/contract-whist/admin#<token>` while signed in and
     tap **Make me the admin**. It works once, for the first admin only;
     remove the variable afterwards. Admins can create password reset links
     and manage any game.
   - `IMPORT_TOKEN` (optional, temporary): enables the one-off InstantDB
     import, `POST /contract-whist/api/admin/import` with the export JSON
     and an `x-import-token` header. It only works on an empty database, and
     all players come across unclaimed. `server/scripts/export-instant.mjs`
     makes the JSON (see the comment at its top). Remove the variable once
     done.
   - `TRUST_PROXY_HOPS` (default `1`): how many proxies sit in front of the
     server. The client's IP, used for rate limiting, is the Nth entry from
     the end of `X-Forwarded-For` (each proxy appends the address it saw), so
     `1` means the last entry, as set by one host nginx using
     `proxy_add_x_forwarded_for`. Use `2` if another proxy sits in front of
     that, and `0` to ignore the header and use the connection's address.
   - `BACKUP_DAYS` (default `14`, `0` turns backups off): see Backups below.
   - `DATA_DIR` (default `/data`), `PORT` (default 3001) and `HOST` (default
     `127.0.0.1`) rarely need changing.

People sign in with a passkey (Face ID, fingerprint) or email and password.
A lost passkey is replaced by making a new one on a device that still signs
in; there is no recovery for an account whose only passkey is gone, so the
You page asks for a second one. Signed-in accounts can delete themselves
from the You page (the row stays as a tombstone so its id is never reused;
games and scores stay).

Password recovery is manual: an admin creates a one-time link for a user on
the admin page (or `POST /contract-whist/api/auth/reset-link` with
`{ "email": "..." }`) and sends it to them; the link opens
`${PUBLIC_URL}/reset#<token>`. There is no email sending.

**Backups.** On startup and then every 24 hours the server writes a copy of
the database (`VACUUM INTO`) to `/data/backups/whist-YYYY-MM-DD.db`, skipping
the day if its copy exists, and keeps the newest `BACKUP_DAYS` copies. Files
are private (0600). A failed backup is logged and never stops the server.
These live on the same volume, so they protect against mistakes, not against
losing the disk: copy them elsewhere too.

### Cutting over from joseffsmith.uk/contract-whist

Guest games and the theme setting live in the browser's localStorage, which
is tied to the origin (`joseffsmith.uk`). Redirecting to a new domain would
lose them, and installed home-screen apps would break out of standalone
mode. Instead, proxy the existing path to the Coolify app from the nginx
that serves `joseffsmith.uk`:

```nginx
location /contract-whist/ {
  proxy_pass https://whist.joseffsmith.uk;
  proxy_set_header Host whist.joseffsmith.uk;
  proxy_ssl_server_name on;
}
```
