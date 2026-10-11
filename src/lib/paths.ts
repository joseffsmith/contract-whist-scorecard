// The app's public base path without a trailing slash ("/contract-whist").
// import.meta.env.BASE_URL mirrors vite's `base`, which has no trailing
// slash here, so never concatenate it directly.
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/+$/, "");

export const appUrl = (path: string) =>
  `${window.location.origin}${BASE_PATH}/${path.replace(/^\/+/, "")}`;
