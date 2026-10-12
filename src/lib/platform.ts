// Where the app is running: "ios" or "android" inside the native app (the
// Capacitor bridge puts `window.Capacitor` there before the page loads),
// "web" otherwise. Synchronous, so screens can decide what to show at once.
export type Platform = "ios" | "android" | "web";

export function platform(): Platform {
  if (import.meta.env.MODE !== "mobile" || typeof window === "undefined")
    return "web";
  const name = (
    window as { Capacitor?: { getPlatform?: () => string } }
  ).Capacitor?.getPlatform?.();
  return name === "ios" || name === "android" ? name : "web";
}

// The major version of the phone's OS, from the WebView's user agent
// ("iPhone OS 17_4", "Android 14"); 0 if it can't tell.
export function osVersion(): number {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const match = /\bOS (\d+)_/.exec(ua) ?? /\bAndroid (\d+)/.exec(ua);
  return match ? Number(match[1]) : 0;
}
