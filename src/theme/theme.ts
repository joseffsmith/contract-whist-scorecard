import { useSyncExternalStore } from "react";

// The user's theme preference. "system" follows the OS light/dark setting.
// index.html applies the saved preference before first paint so there's no
// flash; this module keeps it in sync afterwards.
export type ThemePref = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

const KEY = "whist-theme";
const THEME_COLOR: Record<ResolvedTheme, string> = {
  dark: "#0a2a21",
  light: "#ece2c8",
};

const lightQuery = window.matchMedia("(prefers-color-scheme: light)");

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "system") return v;
  } catch {}
  return "dark";
}

let pref = readPref();
const listeners = new Set<() => void>();

const resolve = (p: ThemePref): ResolvedTheme =>
  p === "system" ? (lightQuery.matches ? "light" : "dark") : p;

function apply() {
  const resolved = resolve(pref);
  const root = document.documentElement;
  if (resolved === "light") root.dataset.theme = "light";
  else delete root.dataset.theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLOR[resolved]);
  listeners.forEach((l) => l());
}

lightQuery.addEventListener("change", () => {
  if (pref === "system") apply();
});

export function setThemePref(next: ThemePref) {
  pref = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {}
  apply();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useTheme() {
  const current = useSyncExternalStore(subscribe, () => pref);
  const resolved = useSyncExternalStore(subscribe, () => resolve(pref));
  return {
    pref: current,
    resolved,
    setPref: setThemePref,
    toggle: () => setThemePref(resolved === "light" ? "dark" : "light"),
  };
}
