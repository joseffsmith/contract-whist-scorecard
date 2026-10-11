import type { CapacitorConfig } from "@capacitor/cli";

// The web app runs from files bundled in the app (../dist-mobile), at
// capacitor://localhost on iOS and https://localhost on Android. Those two
// are the origins the server's CORS allows (server/src/cors.ts).
const config: CapacitorConfig = {
  appId: "uk.joseffsmith.whist",
  appName: "Whist",
  webDir: "../dist-mobile",
  // Dark felt, shown behind the page while it loads and when overscrolled.
  backgroundColor: "#0a2a21",
  ios: {
    // Safe areas come from CSS env() (index.css); the page scrolls inside its
    // own panels, so the WebView itself never needs to rubber-band.
    contentInset: "never",
    scrollEnabled: false,
    allowsLinkPreview: false,
  },
  plugins: {
    SplashScreen: {
      // src/lib/native.ts hides it once React has rendered; this is the
      // backstop if that never happens.
      launchAutoHide: true,
      launchShowDuration: 3000,
      backgroundColor: "#0a2a21",
      showSpinner: false,
    },
    SystemBars: {
      // Android: draw under the bars; env(safe-area-inset-*) has the sizes.
      insetsHandling: "css",
      style: "DARK",
    },
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
