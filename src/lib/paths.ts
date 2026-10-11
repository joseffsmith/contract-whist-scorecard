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
export const appUrl = (path: string) => {
  const root = (
    import.meta.env.VITE_PUBLIC_URL || `${window.location.origin}${BASE_PATH}`
  ).replace(/\/+$/, "");
  return `${root}/${path.replace(/^\/+/, "")}`;
};
