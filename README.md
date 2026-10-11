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
     Default `https://whist.joseffsmith.uk/contract-whist`.
   - `ADMIN_BOOTSTRAP_TOKEN`: a long random secret. After signing up, call
     `POST /contract-whist/api/auth/claim-admin` with `{ "token": "..." }`
     while signed in to make your account the admin. It works once, for the
     first admin only; remove the variable afterwards.
   - `IMPORT_TOKEN` (optional, temporary): enables the one-off InstantDB
     import, `POST /contract-whist/api/admin/import` with the export JSON
     and an `x-import-token` header. It only works on an empty database, and
     all players come across unclaimed. Remove the variable once done.
   - `DATA_DIR` (default `/data`), `PORT` (default 3001) and `HOST` (default
     `127.0.0.1`) rarely need changing.

Password recovery is manual: the admin creates a one-time link for a user with
`POST /contract-whist/api/auth/reset-link` (`{ "email": "..." }`) and sends it
to them; the link opens `${PUBLIC_URL}/reset#<token>`.

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
