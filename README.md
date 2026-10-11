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
