// The app's public base path without a trailing slash ("/contract-whist").
// import.meta.env.BASE_URL mirrors vite's `base`, which has no trailing
// slash here, so never concatenate it directly. In the native app (build
// mode "mobile") the base is "/", so this is "".
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/+$/, "");

// Where the sync API lives. The website calls its own origin; the native app
// is served from capacitor://localhost, so .env.mobile gives it a full URL.
export const API_BASE: string = (
  import.meta.env.VITE_API_BASE || `${BASE_PATH}/api`
).replace(/\/+$/, "");

// A link to the website for sharing (QR codes, invites). Inside the native
// app window.location.origin is capacitor://localhost, which nobody else can
// open, so .env.mobile sets VITE_PUBLIC_URL to the real site.
export const appUrl = (path: string): string => {
  const root = (
    import.meta.env.VITE_PUBLIC_URL || `${window.location.origin}${BASE_PATH}`
  ).replace(/\/+$/, "");
  return `${root}/${path.replace(/^\/+/, "")}`;
};

// The route inside the app for a link to this site (one the phone opened in
// the app: a universal link or App Link), e.g.
// https://joseffsmith.uk/contract-whist/join/abc → /join/abc. Undefined for
// anything else.
export function routeFor(link: string): string | undefined {
  let url: URL, root: URL;
  try {
    url = new URL(link);
    root = new URL(appUrl(""));
  } catch {
    return undefined;
  }
  const base = root.pathname.replace(/\/+$/, "");
  if (url.origin !== root.origin) return undefined;
  if (url.pathname !== base && !url.pathname.startsWith(`${base}/`))
    return undefined;
  return (url.pathname.slice(base.length) || "/") + url.search + url.hash;
}
