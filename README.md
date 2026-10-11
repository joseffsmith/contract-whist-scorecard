# Contract whist scorecard

Demo: https://joseffsmith.uk/contract-whist

## Stretch goals
- reorder players
- mix order of suits
- tell you who's turn it is to deal (over multiple games)

## Deploying (Coolify)

The repo ships a `Dockerfile` that builds the app and serves it with nginx on
port 80 under `/contract-whist/` (`/` redirects there).

1. In Coolify: **+ New → Resource → Private repository (with GitHub App)**,
   pick `joseffsmith/contract-whist-scorecard`, branch `main`.
2. **Build pack:** Dockerfile. **Ports exposes:** `80`.
3. **Domain:** e.g. `https://whist.joseffsmith.uk`. Leave any "strip prefix"
   option off; the app expects the `/contract-whist/` path.
4. Keep **Auto deploy** on, so every push to `main` deploys.

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
