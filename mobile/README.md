# Whist for iOS and Android

The web app, wrapped in a native shell with [Capacitor](https://capacitorjs.com).
The plan and what comes next are in `PLAN.md`; this file is how to build and
ship what exists now.

The app bundles the web build (`npm run build:mobile` at the repo root, output
`dist-mobile/`), so it opens with no signal. It talks to the same server as the
website, `https://joseffsmith.uk/contract-whist/api`, so games, accounts and
live updates are shared. The addresses live in `../.env.mobile`.

## Layout

```
package.json          Capacitor CLI + the native platforms and plugins
capacitor.config.ts   app id uk.joseffsmith.whist, name Whist, webDir ../dist-mobile
ios/                  Xcode project (Swift Package Manager: no CocoaPods)
android/              Gradle project
assets/               icon and splash sources (make-sources.mjs builds them)
```

There are two `package.json` files on purpose. `cap sync` looks for plugins in
the folder that holds `capacitor.config.ts`, so every plugin has to be here for
the native projects to link it. The web bundle also imports `@capacitor/core`,
`app`, `haptics` and `splash-screen` (see `../src/lib/native.ts`), so those four
are in the root `package.json` too. Keep the versions of the two in step.
`@capacitor/keyboard` and the platforms are only needed here.

## One-off setup on the Mac

You need Xcode (from the App Store, then open it once so it installs its
components), Android Studio, and Node 22.

```sh
npm ci
npm run build:mobile
cd mobile
npm ci
npx cap sync
npx cap open ios
```

## iOS

**Run on your iPhone**

1. In Xcode, pick the `App` project, then the `App` target, then Signing &
   Capabilities. Tick "Automatically manage signing" and choose your Team. The
   bundle id is `uk.joseffsmith.whist`; Xcode registers it for you.
2. Plug in the iPhone and unlock it. On the phone turn on Settings, Privacy &
   Security, Developer Mode (it restarts).
3. Choose your phone at the top of Xcode and press Run. The first time, trust
   your developer profile under Settings, General, VPN & Device Management.

**First TestFlight build**

1. In App Store Connect, My Apps, New App: platform iOS, a name, primary
   language, the bundle id `uk.joseffsmith.whist`, any SKU. The name has to be
   unique across the App Store, so "Whist" may be taken; the name on the home
   screen stays "Whist" regardless.
2. In Xcode choose the destination "Any iOS Device (arm64)", then Product,
   Archive. When the Organizer opens, Distribute App, App Store Connect,
   Distribute.
3. The build shows up in App Store Connect, TestFlight after a few minutes of
   processing. Add yourself and friends under Internal Testing (people in your
   App Store Connect team) or External Testing (anyone, via a public link; the
   first build needs a short Beta App Review).

Every upload needs a build number higher than the last (Xcode, App target,
General, Build). Builds expire after 90 days.

**TestFlight from GitHub Actions** (experimental: never run end to end)

Make the first upload through Xcode on the Mac, as above; that also proves your
App Store Connect record and signing work. The `testflight` job is a later
convenience and may need adjusting the first time it runs.

Run the app on your phone once first so the bundle id and your device are
registered. Then, in App Store Connect, Users and Access, Integrations, App
Store Connect API, create a team key. Give it the Admin role, since Xcode's
cloud signing creates the certificates and profiles itself and the lower roles
may be refused. Download the `.p8` once. Add these repository secrets (Settings,
Secrets and variables, Actions):

| Secret | Value |
|---|---|
| `ASC_KEY_ID` | the key's ID |
| `ASC_ISSUER_ID` | the issuer ID shown above the key list |
| `ASC_KEY_P8` | the whole contents of the `.p8` file, BEGIN and END lines included |
| `APPLE_TEAM_ID` | the 10-character Team ID (developer.apple.com, Membership details) |

Then Actions, Mobile, Run workflow. The `testflight` job is skipped when a
secret is missing, and only runs when started by hand. It uses the workflow's
run number as the build number (and tells Xcode not to change it), so once CI
ships builds, stop uploading from Xcode, or the numbers collide.

If automatic signing fails on the runner (for example no certificate can be
created), switch the job to manual signing: export an Apple Distribution
certificate from Keychain Access as a `.p12`, download an App Store
provisioning profile for `uk.joseffsmith.whist`, and store both (base64) with
the `.p12` password as secrets. The job then imports them into a temporary
keychain, installs the profile, archives with `CODE_SIGN_STYLE=Manual`, and
exports with `signingStyle` manual and a `provisioningProfiles` entry in
`ExportOptions.plist`. The API key is still used for the upload.

## Android

```sh
cd mobile
npx cap open android
```

Android Studio syncs Gradle on first open (it downloads what it needs). Run on
a phone with USB debugging, or an emulator. `./gradlew assembleDebug` in
`mobile/android` makes `app/build/outputs/apk/debug/app-debug.apk`, which CI also
uploads as an artifact for sideloading.

**Google Play internal testing**

1. In Play Console, Create app (name, language, App, Free) and accept the
   declarations. Fill in what it asks before it lets you release: privacy
   policy, data safety, content rating.
2. In Android Studio, Build, Generate Signed App Bundle, Android App Bundle.
   Make a new keystore and keep it and its passwords somewhere safe; Play's
   "Play App Signing" holds the real signing key, so this is only the upload
   key. Choose the `release` build.
3. In Play Console, Testing, Internal testing, Create new release, upload the
   `.aab`. Under the Testers tab, make an email list and add yourself and your
   friends, then send them the opt-in link.

Every upload needs a higher version code. It defaults to 1; set it with
`./gradlew bundleRelease -PversionCode=2` (or `VERSION_CODE=2`), or from the
Android Studio terminal. `-PversionName=1.1` sets the name. Never commit the
keystore (`*.jks`, `*.keystore` and `keystore.properties` are ignored).

## After changing the web app

```sh
npm run build:mobile      # repo root
cd mobile && npx cap sync
```

then run or archive again from Xcode or Android Studio. Nothing native changes
unless you add a plugin (then `npm i` it in both `package.json` files and sync).
CI does the same (Android debug APK, iOS simulator build) on every pull request and push to `main` that touches `src/`, `shared/` or `mobile/`.

## Good to know

- **Origins.** The WebView's origin is `capacitor://localhost` on iOS and
  `https://localhost` on Android (Capacitor's default `androidScheme` is
  `https` and the hostname `localhost`). The server allows exactly those in
  `server/src/cors.ts`; set `CORS_ORIGINS` (comma-separated bare origins, such
  as `http://localhost:5173`) on the server to allow more. Links shown or shared from the app (QR codes, invites)
  use `VITE_PUBLIC_URL`, so they open the website.
- **Fonts** are bundled (`src/fonts.css`), so the app looks the same offline.
- **iPhone only.** The Xcode project targets iPhone (`TARGETED_DEVICE_FAMILY`
  1), so App Store Connect needs no iPad screenshots.
- **Android back button** closes an open sheet first (`src/lib/backStack.ts`),
  then goes back, then leaves the app. Small pop-ups that aren't sheets (the
  delete confirmation, the "more" menu) don't hook in yet.
- **Icon and splash.** Edit `assets/make-sources.mjs` (or replace the PNGs),
  then `node assets/make-sources.mjs && npm run assets` and commit what changes
  under `ios/` and `android/`.
- **Safe areas.** The page draws under the status bar and home indicator and
  pads itself with `env(safe-area-inset-*)` (only inside the app; see
  `src/index.css`). Rubber-banding is off with `overscroll-behavior`, not
  `scrollEnabled`, because the login screens scroll the page itself.
