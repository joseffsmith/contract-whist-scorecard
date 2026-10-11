import reactRefresh from "@vitejs/plugin-react-refresh";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const apiProxy = {
  target: "http://127.0.0.1:3001",
  rewrite: (path: string) => path.replace(/^\/contract-whist\/api/, ""),
};

// https://vitejs.dev/config/
// `--mode mobile` builds the bundle for the Capacitor app (see mobile/): it's
// served from the app's own origin at "/", has no service worker (the files
// are bundled in the app) and reads its API address from .env.mobile.
export default defineConfig(({ mode }) => {
  const mobile = mode === "mobile";
  return {
    plugins: [
      reactRefresh(),
      !mobile &&
        VitePWA({
          registerType: "autoUpdate",
          includeAssets: ["favicon.ico", "apple-touch-icon.png"],
          manifest: {
            name: "contract-whist-scorecard",
            short_name: "whist",
            theme_color: "#0a2a21",
            background_color: "#0a2a21",
            display: "standalone",
            start_url: "/contract-whist/",
            scope: "/contract-whist/",
            icons: [
              {
                src: "android-chrome-192x192.png",
                sizes: "192x192",
                type: "image/png",
              },
              {
                src: "android-chrome-512x512.png",
                sizes: "512x512",
                type: "image/png",
              },
            ],
          },
          workbox: {
            navigateFallback: "/contract-whist/index.html",
            navigateFallbackDenylist: [/^\/contract-whist\/api\//],
            globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
          },
        }),
    ],
    esbuild: {
      jsxInject: `import * as React from "react"`,
    },
    css: {
      // Don't walk up to find a stray postcss.config.js in a parent dir.
      postcss: { plugins: [] },
    },
    base: mobile ? "/" : "/contract-whist",
    // Local dev/preview: forward the API to the Node server
    // (`npm run build:server && DATA_DIR=/tmp/whist node server/dist/index.mjs`).
    server: { proxy: { "/contract-whist/api": apiProxy } },
    preview: { proxy: { "/contract-whist/api": apiProxy } },
  };
});
