import reactRefresh from "@vitejs/plugin-react-refresh";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [reactRefresh()],
  esbuild: {
    jsxInject: `import * as React from "react"`,
  },
  css: {
    // Don't walk up to find a stray postcss.config.js in a parent dir.
    postcss: { plugins: [] },
  },
  base: "/contract-whist",
});
