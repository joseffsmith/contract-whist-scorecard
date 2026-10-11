import { App } from "@capacitor/app";
import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { SplashScreen } from "@capacitor/splash-screen";
import { resolvedTheme, subscribeTheme } from "../theme/theme";

// The bits that only exist inside the Capacitor app (see mobile/). Every
// helper is a no-op on the web, so screens can call them unconditionally.
export const isNative = () => Capacitor.isNativePlatform();

// A missed buzz is never worth an error.
const ignore = () => {};

// Light tick for a choice (a bid, a trick count).
export const tap = () => {
  if (isNative()) Haptics.impact({ style: ImpactStyle.Light }).catch(ignore);
};

// A round or the game finished.
export const success = () => {
  if (isNative())
    Haptics.notification({ type: NotificationType.Success }).catch(ignore);
};

// A tap on something that isn't allowed.
export const warning = () => {
  if (isNative())
    Haptics.notification({ type: NotificationType.Warning }).catch(ignore);
};

// Status bar (and Android navigation bar) icons: light on the dark felt,
// dark on the light theme.
const syncSystemBars = () => {
  const style =
    resolvedTheme() === "light" ? SystemBarsStyle.Light : SystemBarsStyle.Dark;
  SystemBars.setStyle({ style }).catch(ignore);
};

// Call once, before the first render. The WebView draws under the system
// bars, so the `native` class turns on the safe-area padding in index.css.
export function initNative() {
  if (!isNative()) return;
  document.documentElement.classList.add("native");

  syncSystemBars();
  subscribeTheme(syncSystemBars);

  // Android back button: go back, or leave the app from the first screen.
  App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else App.minimizeApp().catch(ignore);
  });

  // Keep the splash up until React has put something on screen. (The config
  // also hides it after a few seconds, in case this never runs.)
  const root = document.getElementById("root")!;
  const hideSplash = () => SplashScreen.hide().catch(ignore);
  if (root.childElementCount) hideSplash();
  else
    new MutationObserver((_, observer) => {
      observer.disconnect();
      hideSplash();
    }).observe(root, { childList: true });
}
