import { App } from "@capacitor/app";
import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { SplashScreen } from "@capacitor/splash-screen";
import { resolvedTheme, subscribeTheme } from "../theme/theme";
import { closeTopLayer } from "./backStack";
import { routeFor } from "./paths";

// The Capacitor plugin calls behind src/lib/native.ts, which loads this file
// only in the mobile build. Every helper is a no-op outside the native app.
const isNative = () => Capacitor.isNativePlatform();

// A missed buzz is never worth an error.
const ignore = () => {};

export const tap = () => {
  if (isNative()) Haptics.impact({ style: ImpactStyle.Light }).catch(ignore);
};

export const success = () => {
  if (isNative())
    Haptics.notification({ type: NotificationType.Success }).catch(ignore);
};

export const warning = () => {
  if (isNative())
    Haptics.notification({ type: NotificationType.Warning }).catch(ignore);
};

// Status bar (and Android navigation bar) icons: light on the dark felt,
// dark on the light theme. The theme is read from the saved preference, so
// this is right from the first call.
const syncSystemBars = () => {
  const style =
    resolvedTheme() === "light" ? SystemBarsStyle.Light : SystemBarsStyle.Dark;
  return SystemBars.setStyle({ style }).catch(ignore);
};

export function initNative(open: (route: string) => void = () => {}) {
  if (!isNative()) return;
  // The WebView draws under the system bars: this turns on the safe-area
  // padding in index.css.
  document.documentElement.classList.add("native");

  const barsSet = syncSystemBars();
  subscribeTheme(syncSystemBars);

  // Android back button: close the sheet that's open, else go back, else
  // leave the app from the first screen.
  App.addListener("backButton", ({ canGoBack }) => {
    if (closeTopLayer()) return;
    if (canGoBack) window.history.back();
    else App.minimizeApp().catch(ignore);
  });

  // A link to the site opened in the app (universal link, App Link): show
  // that page. A link that started the app can arrive both as an event and as
  // the launch URL, so the same link twice within a few seconds opens once.
  let last = { url: "", at: 0 };
  const openLink = (url: string | undefined) => {
    const route = url && routeFor(url);
    if (!route) return;
    if (url === last.url && Date.now() - last.at < 3000) return;
    last = { url, at: Date.now() };
    open(route);
  };
  App.addListener("appUrlOpen", ({ url }) => openLink(url));
  App.getLaunchUrl()
    .then((launch) => openLink(launch?.url))
    .catch(ignore);

  // Ask the OS not to clear the offline data when it's short of space.
  navigator.storage?.persist?.().catch(ignore);

  // Keep the splash up until React has put something on screen (this runs
  // asynchronously, so it may be before or after the first render). The
  // config also hides it after a few seconds, in case this never runs.
  const root = document.getElementById("root")!;
  const hideSplash = () =>
    barsSet.then(() => SplashScreen.hide()).catch(ignore);
  if (root.childElementCount) hideSplash();
  else
    new MutationObserver((_, observer) => {
      observer.disconnect();
      hideSplash();
    }).observe(root, { childList: true });
}
