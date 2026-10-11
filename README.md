# Contract whist scorecard

Demo: https://joseffsmith.uk/contract-whist

## Stretch goals
- reorder players
- mix order of suits
- tell you who's turn it is to deal (over multiple games)

## Offline first

Anyone who has opened the app before must be able to use it with no signal.
The service worker serves the app shell; InstantDB serves data from its
local cache and queues writes until it reconnects. InstantDB can only answer
queries it has run before, so:

- Screens read from the broad, always-subscribed queries (`queryHomeGames`,
  `queryPlayerDirectory`; see `src/lib/offline.ts`) and pick out what they
  need, rather than querying one record by id.
- Don't use `db.queryOnce` in core flows (dealing, scoring, adding players).
  Server-only actions (merging, joining by QR) go through `online()` so they
  fail fast with a clear message.
- Find "my player" by `claimedBy`, not the `$user` link (the server-only
  `$users` table can't be resolved from the cache).

Test offline with a production build (`npm run build && npm run serve`) and
Playwright's `context.setOffline(true)`.

## Deploying (Coolify)

The repo ships a `Dockerfile` that builds the app and serves it with nginx on
port 80 under `/contract-whist/` (`/` redirects there).

1. In Coolify: **+ New → Resource → Private repository (with GitHub App)**,
   pick `joseffsmith/contract-whist-scorecard`, branch `main`.
2. **Build pack:** Dockerfile. **Ports exposes:** `80`.
3. **Domain:** e.g. `https://whist.joseffsmith.uk`. Leave any "strip prefix"
   option off; the app expects the `/contract-whist/` path.
4. Keep **Auto deploy** on, so every push to `main` deploys.
5. For email + password sign-in (`server/auth.mjs`): add a persistent volume
   at `/data` (password hashes live there) and set the `INSTANT_ADMIN_TOKEN`
   environment variable (InstantDB dashboard → Admin). Without the token the
   app just offers email codes.

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
