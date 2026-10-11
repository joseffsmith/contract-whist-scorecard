# Native app plan (iOS + Android)

Status: plan only. Nothing in `src/`, `server/` or `shared/` changes until a
phase below starts. The app lives in this `mobile/` folder.

## What we want

- Sign in without typing an email or password: **Sign in with Apple** and
  **passkeys**.
- Phones at the same table find each other, so the host can seat people with
  one tap: **Multipeer Connectivity** and **Nearby Interaction** on iPhone, and
  an equivalent on Android.
- Android as well as iOS, and not a Swift codebase.
- Offline-first, same as the web app today.

## Recommendation: Capacitor around the existing web app

Capacitor puts the web app we already have (React + the `src/sync` engine +
`shared/`) inside a native shell, with plugins for the native bits. One
codebase serves the web, iOS and Android.

| | Capacitor (recommended) | Expo / React Native |
|---|---|---|
| UI | Reuse every screen as is | Rewrite every screen in React Native |
| Sync engine | Unchanged (IndexedDB in the WebView) | New storage adapter (SQLite); SSE needs a streaming fetch |
| Offline | App files are bundled, so offline works from the first open and there's no service worker | Same |
| Native code | Small plugins (Swift and Kotlin) for proximity only | Same plugins, as Expo modules |
| iOS builds without a Mac | GitHub Actions macOS runner + fastlane | EAS Build (Expo's cloud) |
| Look and feel | Web UI, already tuned for phones | Fully native controls |

Either way, the proximity features need some native code. In both options
that code is a few hundred lines per plugin, and I'd write and maintain it;
there's no Swift app to look after. Capacitor wins because there's nothing
to rewrite and the web app keeps improving at the same time. Switch to Expo
only if the WebView feel turns out to be a real problem.

Storage bonus: data inside an app's WebView isn't subject to Safari's
seven-day eviction for websites, so offline data is safer than in the PWA.

## Folder layout

```
mobile/
  package.json          Capacitor CLI + plugins (own deps, not the web app's)
  capacitor.config.ts   appId uk.joseffsmith.whist, webDir ../dist-mobile
  ios/                  generated Xcode project (committed)
  android/              generated Gradle project (committed)
  plugins/table-nearby/ our proximity plugin (TS API + Swift + Kotlin)
  fastlane/             TestFlight + Play internal-testing lanes
```

The web build gets a `mobile` mode (`vite build --mode mobile --outDir
dist-mobile`) that only changes:

- `base` is `/` instead of `/contract-whist/`.
- The API base is absolute: `https://joseffsmith.uk/contract-whist/api`.
- No service worker registration.
- A small `platform.ts` exposes native features when running inside the app
  and falls back to the web versions otherwise.

## Server changes the app needs

1. **CORS** for `capacitor://localhost` (iOS) and `https://localhost`
   (Android). Auth is a Bearer token rather than a cookie, so plain CORS is
   enough, and the SSE stream works through a normal `fetch`.
2. **Identities table**: `identities(user_id, provider, subject, data,
   created_at)`. One user can have several: Apple, any number of passkeys,
   and email/password stays as it is. A guest that signs in with Apple or a
   passkey is upgraded in place, exactly like `signup` does today.
3. **`POST /auth/apple {identityToken, nonce}`**: verify Apple's JWT against
   Apple's published keys (cached), checking `iss`, `aud` (bundle id, plus
   the Services ID for the web) and `nonce`. The email is optional, because
   people can hide it.
4. **Passkeys**: `/auth/passkey/register/{options,verify}` and
   `/auth/passkey/login/{options,verify}` using `@simplewebauthn/server`.
5. **`DELETE /auth/me`**: delete your account. The App Store requires this in
   any app that lets you create an account. It releases claimed players,
   deletes identities and sessions, and keeps games and scores.
6. **Universal links / App Links**: `/.well-known/apple-app-site-association`
   and `/.well-known/assetlinks.json` on joseffsmith.uk. A scanned join QR
   then opens the app when it's installed, and the browser when it isn't.
   Passkeys need the AASA file too. joseffsmith.uk's `/` goes to another
   service (port 8001), so these two files get their own small host nginx
   block.

## Proximity

There's no single API that works across platforms:

- Multipeer Connectivity is iPhone ↔ iPhone only.
- Google Nearby Connections is Android ↔ Android only.
- Nearby Interaction (UWB) needs an iPhone 11 or newer and a token exchanged
  over another channel first. Android support is patchy.

The plan is layered:

1. **Bluetooth LE discovery (all phones).** The host's phone advertises a
   "whist table" BLE service carrying a short table code. Other phones scan
   and show "Join Joe's table?". Tapping it seats you via the normal sync
   action (queued if offline). An existing cross-platform BLE plugin may be
   enough; otherwise this is the core of `plugins/table-nearby`. QR stays as
   the fallback.
2. **Multipeer / Nearby Connections**, only if BLE proves flaky in practice.
   It's the same flow behind the same plugin API.
3. **Nearby Interaction (iPhone extra): seat order by where people sit.**
   UWB gives the direction and distance of each phone, so the host can tap
   "order seats" and get the clockwise order around the table, which also
   sets the dealer rotation. It's skipped on phones without UWB.
4. **Later, maybe: play without signal at the table.** Phones pass queued
   actions to each other over the peer link so everyone sees the live game
   with no signal. Action ids already make pushes idempotent, but the server
   checks permissions against the person who pushes, so actions would need to
   carry who made them. That's a design task of its own and is out of scope
   for the first release.

## Phases

| # | What | Where it ships | Notes |
|---|---|---|---|
| 1 | Passkeys + delete account | Web app (PWA) | No app needed. Fastest win: sign in with Face ID on joseffsmith.uk |
| 2 | Capacitor shell + CI builds | TestFlight, Play internal testing | Mobile build mode, CORS, safe areas, status bar, haptics |
| 3 | Sign in with Apple, native passkeys, universal links | App (+ Apple on web, optional) | Apple JS on the web needs a Services ID and domain check |
| 4 | BLE "join this table" | App | Cross-platform; QR stays |
| 5 | Nearby Interaction seat order | App (iPhone 11+) | Optional extra |
| 6 | Peer relay offline | App | Needs its own design first |

Each phase follows the same pattern as the backend work: a Sonnet builder, an
Opus reviewer, and tests before deploy.

## Distribution

- **iOS**: TestFlight is enough for a group of friends. The public link
  allows up to 10,000 external testers, needs a light beta review, and each
  build lasts 90 days, so CI ships a new build regularly. The App Store can
  come later. A WebView app risks rejection under guideline 4.2 (minimum
  functionality); Sign in with Apple, proximity and haptics help with that.
- **Android**: Play Console has a one-off fee and offers internal testing,
  or share a signed APK for sideloading.
- **Builds without a Mac**:
  - iOS: GitHub Actions on a macOS runner with fastlane. This needs an App
    Store Connect API key and signing certificates as repo secrets.
  - Android: an Ubuntu runner.
  - Private repos spend macOS minutes about 10× faster than Linux minutes,
    which is fine for a handful of builds a month.

## Decisions for you

1. **Capacitor** (recommended) or Expo?
2. **Do you have a Mac?** If not, all iOS builds go through GitHub Actions,
   which works but means slower feedback when something native breaks.
3. **Passkey domain**:
   - Keep `joseffsmith.uk`: the web app lives there. A passkey would then
     also be valid for any other app you put on joseffsmith.uk.
   - Or move the app's canonical address to `whist.joseffsmith.uk`, so its
     passkeys are scoped to whist only. Installed PWAs would need re-adding.
4. **Sign in with Google**: I suggest skipping it. Passkeys already cover
   Android through Google Password Manager. Offering Google login on iOS
   also obliges us to offer a privacy-focused option such as Sign in with
   Apple, which we're doing anyway, but it's one more dependency.
5. **Android distribution**: Play internal testing or sideloaded APK?
6. **Bundle id**: `uk.joseffsmith.whist`?
